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
          name: 'ConversationResponse',
          strict: false, // Can't use strict mode with dynamic additionalProperties
          schema: {
            type: 'object',
            properties: {
              messageType: {
                type: 'string',
                enum: ['document_info', 'general_chat', 'greeting'],
                description: 'Type of user message: document_info if providing data for the document, general_chat for off-topic conversation, greeting for hello/hi messages',
              },
              conversationalResponse: {
                type: 'string',
                description: 'A natural, friendly response to the user message before asking the next question',
              },
              extractedData: {
                type: 'object',
                additionalProperties: { type: 'string' },
                description: 'Data extracted from user message mapped to field keys. Empty object if no data extracted.',
              },
              confidenceLevel: {
                type: 'string',
                enum: ['high', 'medium', 'low'],
                description: 'Overall confidence in the extracted data',
              },
              confidenceReasoning: {
                type: 'string',
                description: 'Brief explanation of confidence level',
              },
              nextQuestion: {
                type: ['string', 'null'],
                description: 'The next field to ask about, or null if complete or clarification needed',
              },
              missingFields: {
                type: 'array',
                items: { type: 'string' },
                description: 'Array of field keys still needed',
              },
              isComplete: {
                type: 'boolean',
                description: 'True if all required fields are collected',
              },
              needsClarification: {
                type: 'boolean',
                description: 'True if the provided data is ambiguous',
              },
              clarificationQuestion: {
                type: ['string', 'null'],
                description: 'Question to clarify ambiguous data, or null if not needed',
              },
            },
            required: [
              'messageType',
              'conversationalResponse',
              'extractedData',
              'confidenceLevel',
              'confidenceReasoning',
              'nextQuestion',
              'missingFields',
              'isComplete',
              'needsClarification',
              'clarificationQuestion',
            ],
            additionalProperties: false,
          },
        },
      },
    });

    console.log('[Chat] Received response from OpenAI');

    // Parse the response
    const aiResponse = JSON.parse(response.output_text);
    const validated = ConversationResponseSchema.parse(aiResponse);

    console.log('[Chat] Message type:', validated.messageType);
    console.log('[Chat] Extracted data:', validated.extractedData);

    // Only merge extracted data if user provided document info
    const shouldUpdateData = validated.messageType === 'document_info' &&
                            Object.keys(validated.extractedData).length > 0;

    const updatedData = shouldUpdateData
      ? { ...collectedData, ...validated.extractedData }
      : collectedData;

    // Calculate completeness
    const requiredFields = fields.filter(f => f.required);
    const filledRequired = requiredFields.filter(f => updatedData[f.key]);
    const completeness = Math.round((filledRequired.length / requiredFields.length) * 100);

    // Build assistant message based on message type and AI response
    let assistantMessageContent = validated.conversationalResponse;

    // Add clarification question if needed
    if (validated.needsClarification && validated.clarificationQuestion) {
      assistantMessageContent += `\n\n${validated.clarificationQuestion}`;
    }
    // Add next question for document info or after greeting
    else if (validated.nextQuestion) {
      assistantMessageContent += `\n\n${validated.nextQuestion}`;
    }
    // Complete message
    else if (validated.isComplete) {
      assistantMessageContent += `\n\nThat's everything! Your document is ready. You can review it in the preview pane and download it when ready.`;
    }

    // Get existing messages and append new ones
    const existingMessages = (draft.messages as any[]) || [];
    const updatedMessages = [
      ...existingMessages,
      { role: 'user', content: message },
      { role: 'assistant', content: assistantMessageContent },
    ];

    // Update draft with new data and messages
    await prisma.draft.update({
      where: { id: draftId },
      data: {
        collectedData: updatedData,
        completeness,
        status: validated.isComplete ? 'complete' : 'collecting',
        messages: updatedMessages,
      },
    });

    console.log('[Chat] Draft updated, completeness:', completeness + '%');

    return NextResponse.json({
      message: assistantMessageContent,
      messageType: validated.messageType,
      extractedData: validated.extractedData,
      confidenceLevel: validated.confidenceLevel,
      confidenceReasoning: validated.confidenceReasoning,
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

  return `You are a friendly AI assistant helping collect information for a SAFE agreement document. You should be conversational, natural, and helpful.

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

**Message Type Classification:**
1. **greeting**: User says hello, hi, hey, etc. → Respond warmly and guide them to start filling the document
2. **general_chat**: User asks off-topic questions or makes casual conversation → Respond naturally but gently redirect to document
3. **document_info**: User provides information for the document → Extract data and ask for next field

**Response Guidelines:**

1. **Always be natural and conversational:**
   - Use the conversationalResponse field to respond warmly to the user
   - Acknowledge what they said before asking the next question
   - Be friendly and encouraging

2. **Handle different message types:**
   - Greeting: "Hi there! I'm here to help you fill out your SAFE agreement. Let's get started..."
   - General chat: Respond to their question briefly, then redirect: "That's interesting! Now, to continue with your document..."
   - Document info: "Great! I've recorded that..." or "Perfect, got it..."

3. **Extract data intelligently:**
   - Be flexible with formats (e.g., "$250k" → "$250,000", "today" → current date)
   - Extract any relevant information and map it to field keys
   - For money fields, preserve formatting like "$250,000"
   - For dates, use YYYY-MM-DD format when possible
   - For jurisdictions, accept state names or "State of [Name]"

4. **Confidence assessment:**
   - confidenceLevel: 'high' if data is clear, 'medium' if normalized, 'low' if ambiguous
   - confidenceReasoning: Briefly explain why

5. **Asking questions:**
   - Ask for ONE piece of information at a time
   - Accept multiple fields if user provides them
   - If user says "I'm not sure" or "skip", note it and move to next field
   - Mark isComplete=true only when ALL required fields are filled

6. **Clarification:**
   - If information is ambiguous, set needsClarification=true
   - Use clarificationQuestion to ask for specifics
   - Keep nextQuestion as null when clarifying

**Example Responses:**

User: "Hello!"
Response: {
  messageType: "greeting",
  conversationalResponse: "Hi there! I'm here to help you fill out your SAFE agreement. This should only take a few minutes.",
  extractedData: {},
  confidenceLevel: "high",
  confidenceReasoning: "Greeting message, no data to extract",
  nextQuestion: "Let's start with the company name. What company is issuing this SAFE?",
  missingFields: ["company_name", "investor_name", ...],
  isComplete: false,
  needsClarification: false,
  clarificationQuestion: null
}

User: "What's the weather like?"
Response: {
  messageType: "general_chat",
  conversationalResponse: "I don't have access to weather information, but I hope it's nice where you are!",
  extractedData: {},
  confidenceLevel: "high",
  confidenceReasoning: "Off-topic question, no document data",
  nextQuestion: "Let's continue with your SAFE agreement. What's the company name?",
  missingFields: ["company_name", "investor_name", ...],
  isComplete: false,
  needsClarification: false,
  clarificationQuestion: null
}

User: "The company is Acme Corp"
Response: {
  messageType: "document_info",
  conversationalResponse: "Perfect! I've recorded Acme Corp as the company name.",
  extractedData: { "company_name": "Acme Corp" },
  confidenceLevel: "high",
  confidenceReasoning: "Clear company name provided",
  nextQuestion: "Great! And who is the investor for this SAFE agreement?",
  missingFields: ["investor_name", "purchase_amount", ...],
  isComplete: false,
  needsClarification: false,
  clarificationQuestion: null
}

User: "The amount is 250k"
Response: {
  messageType: "document_info",
  conversationalResponse: "Got it! I've recorded the purchase amount as $250,000.",
  extractedData: { "purchase_amount": "$250,000" },
  confidenceLevel: "medium",
  confidenceReasoning: "Normalized '250k' to '$250,000'",
  nextQuestion: "What's the post-money valuation cap?",
  missingFields: [...],
  isComplete: false,
  needsClarification: false,
  clarificationQuestion: null
}

User: "It was last month"
Response: {
  messageType: "document_info",
  conversationalResponse: "I understand you're referring to last month, but I need a specific date for the document.",
  extractedData: {},
  confidenceLevel: "low",
  confidenceReasoning: "Date reference is too ambiguous",
  nextQuestion: null,
  missingFields: [...],
  isComplete: false,
  needsClarification: true,
  clarificationQuestion: "Could you provide the specific date? For example: January 15, 2025 or 01/15/2025."
}`;
}
