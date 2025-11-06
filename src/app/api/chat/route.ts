import { NextRequest, NextResponse } from 'next/server';
import { openai } from '@/lib/openai';
import { prisma } from '@/lib/db';
import { ConversationResponseSchema, type Field } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { draftId, message } = await req.json();

    if (!draftId || !message) {
      return NextResponse.json(
        { error: 'Draft ID and message are required' },
        { status: 400 }
      );
    }

    console.log('[Chat] Processing message for draft:', draftId);

    // Load draft
    const draft = await prisma.draft.findUnique({
      where: { id: draftId },
    });

    if (!draft) {
      return NextResponse.json(
        { error: 'Draft not found' },
        { status: 404 }
      );
    }

    const fields = draft.fields as Field[];
    const collectedData = draft.collectedData as Record<string, string>;

    // Build system instructions
    const instructions = buildSystemInstructions(fields, collectedData);

    console.log('[Chat] Sending to OpenAI with conversation:', draft.openaiConvId);

    // Call OpenAI Responses API with Conversations
    const response = await openai.responses.create({
      model: 'gpt-4o-mini',
      conversation: draft.openaiConvId,
      input: [{ role: 'user', content: message }],
      instructions,
      text: {
        format: {
          type: 'json_schema',
          strict: true,
          json_schema: {
            name: 'ConversationResponse',
            strict: true,
            schema: {
              type: 'object',
              properties: {
                extractedData: {
                  type: 'object',
                  additionalProperties: { type: 'string' },
                },
                confidence: {
                  type: 'object',
                  properties: {
                    overall: { type: 'string', enum: ['high', 'medium', 'low'] },
                    perField: {
                      type: 'object',
                      additionalProperties: { type: 'string', enum: ['high', 'medium', 'low'] },
                    },
                    reasoning: { type: 'string' },
                  },
                  required: ['overall', 'perField', 'reasoning'],
                  additionalProperties: false,
                },
                nextQuestion: {
                  type: ['string', 'null'],
                },
                missingFields: {
                  type: 'array',
                  items: { type: 'string' },
                },
                isComplete: { type: 'boolean' },
                needsClarification: { type: 'boolean' },
                clarificationQuestion: { type: 'string' },
              },
              required: [
                'extractedData',
                'confidence',
                'nextQuestion',
                'missingFields',
                'isComplete',
                'needsClarification',
              ],
              additionalProperties: false,
            },
          },
        },
      },
    });

    console.log('[Chat] Received response from OpenAI');

    // Parse the response
    const aiResponse = JSON.parse(response.output_text);
    const validated = ConversationResponseSchema.parse(aiResponse);

    // Merge extracted data
    const updatedData = {
      ...collectedData,
      ...validated.extractedData,
    };

    // Calculate completeness
    const requiredFields = fields.filter(f => f.required);
    const filledRequired = requiredFields.filter(f => updatedData[f.key]);
    const completeness = Math.round((filledRequired.length / requiredFields.length) * 100);

    // Update draft
    await prisma.draft.update({
      where: { id: draftId },
      data: {
        collectedData: updatedData,
        completeness,
        status: validated.isComplete ? 'complete' : 'collecting',
      },
    });

    console.log('[Chat] Draft updated, completeness:', completeness + '%');

    // Build assistant message
    let assistantMessage = '';

    if (validated.needsClarification && validated.clarificationQuestion) {
      assistantMessage = validated.clarificationQuestion;
    } else if (Object.keys(validated.extractedData).length > 0) {
      // Acknowledge what was extracted
      const extractedFields = Object.keys(validated.extractedData).map(key => {
        const field = fields.find(f => f.key === key);
        return field?.label || key;
      });

      assistantMessage = `Got it! I've recorded: ${extractedFields.join(', ')}.`;

      if (validated.nextQuestion) {
        assistantMessage += `\n\n${validated.nextQuestion}`;
      } else if (validated.isComplete) {
        assistantMessage += `\n\nThat's everything! Your document is ready. You can review it in the preview pane and download it when ready.`;
      }
    } else if (validated.nextQuestion) {
      assistantMessage = validated.nextQuestion;
    } else {
      assistantMessage = "I didn't catch that. Could you please provide the information again?";
    }

    return NextResponse.json({
      message: assistantMessage,
      extractedData: validated.extractedData,
      confidence: validated.confidence,
      completeness,
      isComplete: validated.isComplete,
      missingFields: validated.missingFields,
    });
  } catch (error) {
    console.error('[Chat] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process message. Please try again.' },
      { status: 500 }
    );
  }
}

function buildSystemInstructions(fields: Field[], collectedData: Record<string, string>): string {
  const requiredFields = fields.filter(f => f.required);
  const missingFields = requiredFields.filter(f => !collectedData[f.key]);
  const completeness = Math.round(
    ((requiredFields.length - missingFields.length) / requiredFields.length) * 100
  );

  return `You are helping collect information for a SAFE agreement document.

**Current Progress:** ${completeness}% complete (${requiredFields.length - missingFields.length}/${requiredFields.length} required fields filled)

**Already Collected:**
${Object.entries(collectedData).map(([key, value]) => {
  const field = fields.find(f => f.key === key);
  return `- ${field?.label || key}: ${value}`;
}).join('\n') || 'None yet'}

**Still Needed (Required):**
${missingFields.map(f => `- ${f.label}: ${f.example}`).join('\n') || 'All required fields collected!'}

**All Fields:**
${fields.map(f => `- ${f.key}: ${f.label} (${f.type})${f.required ? ' *required*' : ''} - ${f.example}`).join('\n')}

**Your Goals:**
1. Extract ANY relevant information from the user's message and map it to field keys
2. Be flexible with formats (e.g., "$250k" → "$250,000", "today" → current date)
3. Assess confidence for each extracted field (high/medium/low)
4. If information is ambiguous, set needsClarification=true and ask a clarifying question
5. When confident about extraction, ask for the NEXT missing field
6. Be conversational and friendly - acknowledge what you received before asking the next question

**Guidelines:**
- Ask for ONE piece of information at a time
- Accept multiple fields if user provides them
- For money fields, preserve formatting like "$250,000"
- For dates, use YYYY-MM-DD format when possible
- For jurisdictions, accept state names or "State of [Name]"
- If user says "I'm not sure" or "skip", note it and move to next field
- Mark isComplete=true only when ALL required fields are filled
- Return extracted data even if you're asking for clarification

**Example Responses:**

User: "The company is Acme Corp"
Response: {
  extractedData: { "company_name": "Acme Corp" },
  confidence: { overall: "high", perField: { "company_name": "high" }, reasoning: "Clear company name provided" },
  nextQuestion: "Great! And who is the investor for this SAFE agreement?",
  missingFields: ["investor_name", "purchase_amount", ...],
  isComplete: false,
  needsClarification: false
}

User: "The amount is 250k"
Response: {
  extractedData: { "purchase_amount": "$250,000" },
  confidence: { overall: "medium", perField: { "purchase_amount": "medium" }, reasoning: "Normalized '250k' to '$250,000'" },
  nextQuestion: "Got it, $250,000. What's the post-money valuation cap?",
  missingFields: [...],
  isComplete: false,
  needsClarification: false
}

User: "It was last month"
Response: {
  extractedData: {},
  confidence: { overall: "low", perField: {}, reasoning: "Date is ambiguous" },
  nextQuestion: null,
  missingFields: [...],
  isComplete: false,
  needsClarification: true,
  clarificationQuestion: "Could you provide the specific date? For example: January 15, 2025 or 01/15/2025."
}`;
}
