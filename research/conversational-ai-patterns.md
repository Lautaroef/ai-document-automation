# Conversational AI Patterns for Structured Data Collection

## Executive Summary

For building a conversational AI system to collect structured data from users (like missing SAFE agreement information), the **recommended approach** is:

1. **Use OpenAI's Responses API with Conversations API** for state management, combined with **Structured Outputs** (`generateObject` or `streamObject`) for extracting typed data
2. **Leverage Vercel AI SDK** for the frontend with `useChat` hook for seamless UI integration
3. **Implement custom validation logic** to determine completeness and confidence, as there's no built-in "confidence scoring" API
4. **Use a state machine pattern** to track which fields have been collected and what still needs to be asked

**Why this approach?**
- **Simpler architecture**: The new Responses API + Conversations API (replacing deprecated Assistants API) provides cleaner state management without complex thread management
- **Type-safe structured extraction**: Structured Outputs guarantees JSON schema adherence with 100% reliability (vs. 95%+ with JSON mode)
- **Natural conversation flow**: Multi-turn conversations work seamlessly by storing context in Conversation objects
- **Production-ready**: Used by companies like OpenAI, Photoroom, and Zapier

**Cost considerations**: For conversational forms, use `gpt-4.1-mini` ($0.15/1M input, $0.60/1M output) or `gpt-4.1-nano` ($0.05/1M input, $0.40/1M output) for excellent performance at low cost. Reserve `gpt-4.1` ($3.00/$12.00) for complex validation logic.

## Architecture Options

### Option 1: Responses API + Conversations API (RECOMMENDED)

**Architecture:**
```typescript
// Server-side pattern
const conversation = await openai.conversations.create();

const response = await openai.responses.create({
  model: "gpt-4.1-mini",
  conversation: conversation.id,
  input: [{ role: "user", content: userMessage }],
  text: {
    format: {
      type: "json_schema",
      strict: true,
      schema: SafeDataSchema
    }
  }
});
```

**Pros:**
- Clean separation: Conversations store state, Responses generate output
- No need to manually pass message history on each request
- Conversations persist across sessions (30+ days by default)
- Works with both Responses API and Realtime API
- Structured Outputs built-in for reliable JSON extraction

**Cons:**
- Relatively new API (migration from Assistants API ongoing)
- Less community examples than Chat Completions API

**When to use:** Production applications requiring persistent multi-turn conversations with structured data extraction.

### Option 2: Chat Completions API + Manual State Management

**Architecture:**
```typescript
// Manual message history management
const messages = [
  { role: "system", content: systemPrompt },
  ...conversationHistory,
  { role: "user", content: userMessage }
];

const response = await openai.chat.completions.create({
  model: "gpt-4.1-mini",
  messages: messages,
  response_format: {
    type: "json_schema",
    json_schema: SafeDataSchema
  }
});

// Save messages to database
await saveMessages(userId, messages);
```

**Pros:**
- Full control over conversation state
- Well-documented with many examples
- Easy to implement custom pruning/context window management
- Familiar to developers

**Cons:**
- Must manually manage message history
- Need to implement your own persistence layer
- More boilerplate code
- Risk of context window overflow without careful management

**When to use:** When you need fine-grained control over conversation history or have custom state management requirements.

### Option 3: Vercel AI SDK with `streamObject`

**Architecture:**
```typescript
// Frontend
const { object, submit } = useObject({
  api: '/api/extract',
  schema: SafeDataSchema
});

// Backend
import { streamObject } from 'ai';

export async function POST(req: Request) {
  const { messages } = await req.json();

  const result = streamObject({
    model: openai('gpt-4.1-mini'),
    schema: SafeDataSchema,
    messages: messages,
  });

  return result.toTextStreamResponse();
}
```

**Pros:**
- Real-time streaming updates to UI as data is extracted
- Built-in React hooks for seamless integration
- Automatic validation with Zod schemas
- Great developer experience

**Cons:**
- Adds dependency on Vercel AI SDK
- Primarily focused on Next.js/React ecosystems
- Less control over low-level API details

**When to use:** Building React/Next.js applications where you want real-time UI updates during data extraction.

### Option 4: Custom Agent Pattern with Tool Calling

**Architecture:**
```typescript
const tools = {
  updateSafeData: {
    description: "Update SAFE agreement data fields",
    parameters: SafeDataSchema,
    execute: async (data) => {
      await updateDatabase(data);
      return { success: true, missingFields: validateCompleteness(data) };
    }
  }
};

const response = await openai.chat.completions.create({
  model: "gpt-4.1-mini",
  messages: messages,
  tools: [tools.updateSafeData],
  tool_choice: "auto"
});
```

**Pros:**
- Flexible tool-based architecture
- Can combine multiple tools (validation, database updates, calculations)
- Model decides when to call tools vs. ask follow-up questions

**Cons:**
- More complex to implement
- Requires careful tool design and error handling
- Can be unpredictable without proper prompting

**When to use:** Complex workflows requiring multiple operations beyond just data extraction.

## Implementation Pattern: Conversational Data Collection

### Step-by-Step Pattern

**1. Define Your Data Schema**

```typescript
import { z } from 'zod';

const SafeDataSchema = z.object({
  companyName: z.string().optional(),
  investorName: z.string().optional(),
  purchaseAmount: z.number().optional(),
  valuationCap: z.number().optional(),
  discountRate: z.number().optional(),
  issueDate: z.string().optional(),
  // ... other fields
});

type SafeData = z.infer<typeof SafeDataSchema>;
```

**2. Create Conversation State Machine**

```typescript
interface ConversationState {
  conversationId: string;
  collectedData: Partial<SafeData>;
  missingFields: string[];
  currentField: string | null;
  completeness: number; // 0-100%
  lastUpdated: Date;
}

function calculateCompleteness(data: Partial<SafeData>): number {
  const requiredFields = ['companyName', 'investorName', 'purchaseAmount', 'valuationCap'];
  const filledRequired = requiredFields.filter(field => data[field] !== undefined);
  return (filledRequired.length / requiredFields.length) * 100;
}

function getMissingFields(data: Partial<SafeData>): string[] {
  const requiredFields = ['companyName', 'investorName', 'purchaseAmount', 'valuationCap'];
  return requiredFields.filter(field => data[field] === undefined);
}
```

**3. Build Conversational Flow**

```typescript
async function handleUserMessage(
  state: ConversationState,
  userMessage: string
): Promise<ConversationState> {

  // System prompt guides the AI to extract data conversationally
  const systemPrompt = `You are a helpful assistant collecting information for a SAFE agreement.

Current data collected: ${JSON.stringify(state.collectedData, null, 2)}
Missing fields: ${state.missingFields.join(', ')}

Your goals:
1. Extract any relevant information from the user's message
2. Ask ONE follow-up question for the next missing field
3. Be conversational and friendly, not robotic
4. Validate extracted data (e.g., amounts should be positive numbers)
5. If user provides ambiguous information, ask for clarification

When extracting data, return JSON with:
- extractedData: any fields you found in the user's message
- followUpQuestion: the next question to ask (or null if complete)
- clarificationNeeded: true if you need to clarify something`;

  // Use Structured Outputs to extract data
  const response = await openai.responses.create({
    model: "gpt-4.1-mini",
    conversation: state.conversationId,
    instructions: systemPrompt,
    input: [{ role: "user", content: userMessage }],
    text: {
      format: {
        type: "json_schema",
        strict: true,
        schema: {
          type: "object",
          properties: {
            extractedData: {
              type: "object",
              properties: {
                companyName: { type: "string" },
                investorName: { type: "string" },
                purchaseAmount: { type: "number" },
                valuationCap: { type: "number" },
                discountRate: { type: "number" },
                issueDate: { type: "string" }
              },
              additionalProperties: false
            },
            followUpQuestion: {
              type: ["string", "null"],
              description: "Next question to ask, or null if all data collected"
            },
            clarificationNeeded: {
              type: "boolean",
              description: "Whether clarification is needed for ambiguous information"
            }
          },
          required: ["extractedData", "followUpQuestion", "clarificationNeeded"],
          additionalProperties: false
        }
      }
    }
  });

  const result = JSON.parse(response.output_text);

  // Merge extracted data with existing data
  const updatedData = {
    ...state.collectedData,
    ...result.extractedData
  };

  // Update state
  return {
    ...state,
    collectedData: updatedData,
    missingFields: getMissingFields(updatedData),
    completeness: calculateCompleteness(updatedData),
    lastUpdated: new Date()
  };
}
```

**4. Frontend Implementation with React**

```typescript
'use client';

import { useChat } from '@ai-sdk/react';
import { DefaultChatTransport } from 'ai';
import { useState } from 'react';

export default function SafeDataCollector() {
  const { messages, sendMessage, status } = useChat({
    transport: new DefaultChatTransport({
      api: '/api/collect-safe-data',
    }),
  });

  const [input, setInput] = useState('');

  return (
    <div className="max-w-2xl mx-auto p-4">
      <div className="space-y-4 mb-4">
        {messages.map(message => (
          <div
            key={message.id}
            className={`p-3 rounded-lg ${
              message.role === 'user'
                ? 'bg-blue-100 ml-auto'
                : 'bg-gray-100'
            }`}
          >
            {message.parts.map((part, idx) =>
              part.type === 'text' ? (
                <span key={idx}>{part.text}</span>
              ) : null
            )}
          </div>
        ))}

        {status === 'streaming' && (
          <div className="text-gray-500">AI is typing...</div>
        )}
      </div>

      <form
        onSubmit={e => {
          e.preventDefault();
          if (input.trim()) {
            sendMessage({ text: input });
            setInput('');
          }
        }}
        className="flex gap-2"
      >
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          disabled={status !== 'ready'}
          placeholder="Type your response..."
          className="flex-1 p-2 border rounded"
        />
        <button
          type="submit"
          disabled={status !== 'ready'}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
```

**5. Backend API Route**

```typescript
// app/api/collect-safe-data/route.ts
import { openai } from '@ai-sdk/openai';
import { convertToModelMessages, streamText, UIMessage } from 'ai';

export const maxDuration = 30;

export async function POST(req: Request) {
  const { messages }: { messages: UIMessage[] } = await req.json();

  // Load current state from database
  const state = await loadConversationState(req.headers.get('x-user-id'));

  const systemPrompt = buildSystemPrompt(state);

  const result = streamText({
    model: openai('gpt-4.1-mini'),
    system: systemPrompt,
    messages: convertToModelMessages(messages),
  });

  return result.toUIMessageStreamResponse();
}

function buildSystemPrompt(state: ConversationState): string {
  return `You are collecting SAFE agreement data conversationally.

Current progress: ${state.completeness}% complete
Already collected: ${JSON.stringify(state.collectedData, null, 2)}
Still needed: ${state.missingFields.join(', ')}

Guidelines:
- Ask for ONE piece of information at a time
- Be conversational and friendly
- Validate data (e.g., amounts must be positive)
- If information is ambiguous, ask for clarification
- Acknowledge what the user provides before asking the next question

Example conversation flow:
User: "I need to fill out a SAFE agreement"
You: "I'd be happy to help! Let's start with the basics. What's the name of the company issuing the SAFE?"

User: "Acme Corp"
You: "Great! And who is the investor for this SAFE agreement?"`;
}
```

## Code Examples

### Example 1: Simple Extraction with Structured Outputs

```typescript
import { openai } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';

const SafeDataSchema = z.object({
  companyName: z.string().optional(),
  investorName: z.string().optional(),
  purchaseAmount: z.number().optional(),
  valuationCap: z.number().optional(),
});

async function extractSafeData(documentText: string) {
  const { object } = await generateObject({
    model: openai('gpt-4.1-mini'),
    schema: SafeDataSchema,
    prompt: `Extract SAFE agreement information from this document:\n\n${documentText}`,
  });

  return object;
}
```

### Example 2: Streaming Extraction with Real-time Updates

```typescript
import { openai } from '@ai-sdk/openai';
import { streamObject } from 'ai';
import { z } from 'zod';

async function streamSafeDataExtraction(documentText: string) {
  const { partialObjectStream } = streamObject({
    model: openai('gpt-4.1-mini'),
    schema: SafeDataSchema,
    prompt: `Extract SAFE agreement data:\n\n${documentText}`,
  });

  // Stream partial results to UI
  for await (const partialObject of partialObjectStream) {
    console.log('Partial extraction:', partialObject);
    // Update UI with partial results
  }
}
```

### Example 3: Multi-turn Conversation with State

```typescript
import OpenAI from 'openai';

const openai = new OpenAI();

async function conversationalDataCollection(userId: string) {
  // Create or load conversation
  let conversation = await loadUserConversation(userId);

  if (!conversation) {
    conversation = await openai.conversations.create({
      metadata: { userId }
    });
  }

  // Handle each turn
  async function askQuestion(userResponse?: string) {
    const input = userResponse
      ? [{ role: "user" as const, content: userResponse }]
      : [{ role: "user" as const, content: "I need to fill out a SAFE agreement" }];

    const response = await openai.responses.create({
      model: "gpt-4.1-mini",
      conversation: conversation.id,
      input,
      instructions: `You are collecting SAFE agreement data. Ask for one field at a time.
      Current data: ${JSON.stringify(await loadUserData(userId))}`
    });

    return response.output_text;
  }

  return { askQuestion, conversationId: conversation.id };
}
```

### Example 4: Validation and Confidence Scoring

```typescript
interface FieldConfidence {
  field: string;
  value: any;
  confidence: 'high' | 'medium' | 'low';
  needsVerification: boolean;
  reason?: string;
}

async function validateWithConfidence(
  extractedData: Partial<SafeData>
): Promise<FieldConfidence[]> {
  const { object } = await generateObject({
    model: openai('gpt-4.1-mini'),
    schema: z.object({
      validations: z.array(z.object({
        field: z.string(),
        value: z.any(),
        confidence: z.enum(['high', 'medium', 'low']),
        needsVerification: z.boolean(),
        reason: z.string().optional()
      }))
    }),
    prompt: `Analyze this extracted SAFE data and assign confidence levels:

${JSON.stringify(extractedData, null, 2)}

For each field, determine:
- confidence: high (clear and validated), medium (plausible but uncertain), low (ambiguous or contradictory)
- needsVerification: whether we should ask user to confirm
- reason: why the confidence level was assigned

Rules:
- Numbers should be positive
- Dates should be valid
- Names should be properly capitalized
- valuation cap should typically be higher than purchase amount`
  });

  return object.validations;
}
```

### Example 5: Handling Partial/Incomplete Responses

```typescript
async function handlePartialResponse(
  userMessage: string,
  currentData: Partial<SafeData>
): Promise<{
  updatedData: Partial<SafeData>;
  nextQuestion: string;
  isComplete: boolean;
}> {
  const { object } = await generateObject({
    model: openai('gpt-4.1-mini'),
    schema: z.object({
      extractedFields: z.object({
        companyName: z.string().optional(),
        investorName: z.string().optional(),
        purchaseAmount: z.number().optional(),
        valuationCap: z.number().optional(),
        discountRate: z.number().optional(),
        issueDate: z.string().optional(),
      }),
      nextQuestion: z.string(),
      isComplete: z.boolean(),
      missingFields: z.array(z.string())
    }),
    prompt: `Current SAFE data: ${JSON.stringify(currentData)}
User message: "${userMessage}"

Extract any new fields from the user's message and determine the next question to ask.
Mark isComplete as true only if ALL required fields are present.
Required fields: companyName, investorName, purchaseAmount, valuationCap`
  });

  return {
    updatedData: { ...currentData, ...object.extractedFields },
    nextQuestion: object.nextQuestion,
    isComplete: object.isComplete
  };
}
```

## State Management

### Approach 1: Conversation Objects (Recommended)

**Pros:**
- Built-in persistence (30+ days)
- No need to manage message history manually
- Works across sessions and devices
- Automatic context management

**Implementation:**
```typescript
// Create conversation once
const conversation = await openai.conversations.create({
  metadata: { userId, documentId, purpose: 'safe-data-collection' }
});

// Use in subsequent requests
const response = await openai.responses.create({
  model: "gpt-4.1-mini",
  conversation: conversation.id,
  input: [{ role: "user", content: message }]
});

// Conversation automatically maintains state
```

### Approach 2: Database + Manual History

**Implementation:**
```typescript
interface ConversationMessage {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

async function loadConversationHistory(conversationId: string) {
  const messages = await db.messages
    .where('conversationId', conversationId)
    .orderBy('timestamp', 'asc')
    .limit(20) // Keep last 20 messages for context
    .toArray();

  return messages.map(m => ({
    role: m.role,
    content: m.content
  }));
}

async function saveMessage(conversationId: string, role: string, content: string) {
  await db.messages.add({
    id: generateId(),
    conversationId,
    role,
    content,
    timestamp: new Date()
  });
}
```

### Approach 3: Hybrid (Conversation + Structured State)

**Best of both worlds:**
```typescript
interface DataCollectionState {
  conversationId: string;
  userId: string;
  documentId: string;

  // Structured data being collected
  collectedData: Partial<SafeData>;

  // Metadata
  completeness: number;
  missingFields: string[];
  currentStep: string;

  // Conversation metadata
  messageCount: number;
  lastActivity: Date;

  // Validation state
  validationResults: FieldConfidence[];
}

// Store structured state in database
await db.states.upsert({
  conversationId: conversation.id,
  ...state
});

// Use OpenAI conversation for message history
const response = await openai.responses.create({
  model: "gpt-4.1-mini",
  conversation: conversation.id,
  input: [{ role: "user", content: message }]
});
```

## Confidence & Validation

### No Built-in Confidence Scores

**Important:** OpenAI does not provide automatic confidence scores for extracted structured data. You must implement your own validation logic.

### Validation Strategies

**1. Schema Validation (Type Safety)**
```typescript
import { z } from 'zod';

const SafeDataSchema = z.object({
  companyName: z.string()
    .min(1, "Company name is required")
    .max(200, "Company name too long"),
  purchaseAmount: z.number()
    .positive("Purchase amount must be positive")
    .max(100000000, "Purchase amount seems unrealistic"),
  valuationCap: z.number()
    .positive("Valuation cap must be positive")
    .refine(val => val >= 1000000, "Valuation cap seems too low"),
});

// Automatic validation on parse
try {
  const validData = SafeDataSchema.parse(extractedData);
} catch (error) {
  // Handle validation errors
  console.error(error.errors);
}
```

**2. Business Logic Validation**
```typescript
function validateBusinessRules(data: Partial<SafeData>): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Valuation cap should be higher than purchase amount
  if (data.valuationCap && data.purchaseAmount) {
    if (data.valuationCap < data.purchaseAmount * 2) {
      warnings.push("Valuation cap is unusually close to purchase amount");
    }
  }

  // Discount rate should be reasonable
  if (data.discountRate !== undefined) {
    if (data.discountRate < 0 || data.discountRate > 30) {
      errors.push("Discount rate should be between 0% and 30%");
    }
  }

  // Date should not be in the future
  if (data.issueDate) {
    const issueDate = new Date(data.issueDate);
    if (issueDate > new Date()) {
      errors.push("Issue date cannot be in the future");
    }
  }

  return {
    isValid: errors.length === 0,
    errors,
    warnings,
    confidence: errors.length === 0
      ? (warnings.length === 0 ? 'high' : 'medium')
      : 'low'
  };
}
```

**3. LLM-based Confidence Assessment**
```typescript
async function assessConfidence(
  extractedData: Partial<SafeData>,
  sourceText: string
): Promise<ConfidenceAssessment> {
  const { object } = await generateObject({
    model: openai('gpt-4.1-mini'),
    schema: z.object({
      overallConfidence: z.enum(['high', 'medium', 'low']),
      fieldAssessments: z.array(z.object({
        field: z.string(),
        confidence: z.enum(['high', 'medium', 'low']),
        reasoning: z.string(),
        suggestedVerification: z.string().optional()
      })),
      recommendations: z.array(z.string())
    }),
    prompt: `Assess the confidence of this extracted SAFE data:

Extracted Data: ${JSON.stringify(extractedData, null, 2)}
Source Text: ${sourceText}

For each field, determine:
- How confident are you that the extraction is correct?
- Is the value plausible for a SAFE agreement?
- Does it match common patterns?
- Should we ask the user to verify this field?

Provide an overall confidence and per-field assessments.`
  });

  return object;
}
```

**4. Completeness Tracking**
```typescript
function calculateDataCompleteness(
  data: Partial<SafeData>,
  requiredFields: (keyof SafeData)[]
): {
  completeness: number;
  missingRequired: string[];
  missingOptional: string[];
} {
  const allFields = Object.keys(SafeDataSchema.shape) as (keyof SafeData)[];
  const optionalFields = allFields.filter(f => !requiredFields.includes(f));

  const missingRequired = requiredFields.filter(
    field => data[field] === undefined || data[field] === null
  );

  const missingOptional = optionalFields.filter(
    field => data[field] === undefined || data[field] === null
  );

  const completeness =
    ((requiredFields.length - missingRequired.length) / requiredFields.length) * 100;

  return {
    completeness: Math.round(completeness),
    missingRequired,
    missingOptional
  };
}
```

### Handling Ambiguity

**Pattern for asking clarifying questions:**
```typescript
async function generateClarifyingQuestion(
  userMessage: string,
  extractedValue: any,
  fieldName: string
): Promise<string> {
  const { object } = await generateObject({
    model: openai('gpt-4.1-mini'),
    schema: z.object({
      isAmbiguous: z.boolean(),
      clarifyingQuestion: z.string().optional(),
      interpretation: z.string()
    }),
    prompt: `User said: "${userMessage}"
I extracted: ${fieldName} = ${extractedValue}

Is this extraction ambiguous? If yes, generate a clarifying question.
Examples of ambiguity:
- "5 million" could be $5M or 5,000,000 shares
- "end of year" - which year?
- "standard rate" - what is standard?`
  });

  return object.clarifyingQuestion || '';
}
```

## Cost Analysis

### Model Recommendations

**For conversational data collection:**

| Model | Input Cost | Output Cost | Use Case | Est. Cost per Conversation* |
|-------|-----------|-------------|----------|------------------------------|
| **gpt-4.1-nano** | $0.05/1M | $0.40/1M | Simple extraction, classification | $0.0005 |
| **gpt-4.1-mini** | $0.15/1M | $0.60/1M | **Recommended for most use cases** | $0.0015 |
| **gpt-4.1** | $3.00/1M | $12.00/1M | Complex validation, ambiguous cases | $0.015 |
| **gpt-5-mini** | $0.25/1M | $2.00/1M | Agentic tasks with tools | $0.0025 |

*Assumes 5-10 turn conversation with ~2K input tokens and ~500 output tokens per turn

### Cost Optimization Strategies

**1. Use Prompt Caching**
```typescript
// Place static instructions first to maximize cache hits
const systemPrompt = `You are a SAFE agreement data collector...
[Long detailed instructions]`;

const response = await openai.responses.create({
  model: "gpt-4.1-mini",
  instructions: systemPrompt, // Automatically cached
  input: [{ role: "user", content: userMessage }]
});

// Cached input costs 75% less ($0.0375/1M vs $0.15/1M for gpt-4.1-mini)
```

**2. Start with Cheaper Models, Escalate as Needed**
```typescript
async function extractWithFallback(text: string) {
  try {
    // Try cheap model first
    return await extractSafeData(text, 'gpt-4.1-nano');
  } catch (error) {
    // If extraction fails or has low confidence, use better model
    return await extractSafeData(text, 'gpt-4.1-mini');
  }
}
```

**3. Batch Processing**
```typescript
// Use Batch API for 50% discount on non-interactive processing
const batch = await openai.batches.create({
  input_file_id: fileId,
  endpoint: "/v1/chat/completions",
  completion_window: "24h"
});

// Great for processing uploaded documents, not for real-time chat
```

**4. Minimize Context Window Usage**
```typescript
// Only include relevant history, not entire conversation
const relevantHistory = conversationHistory
  .slice(-10) // Last 10 messages
  .filter(m => m.role === 'user' || m.content.includes('SAFE')); // Relevant only

const response = await openai.responses.create({
  model: "gpt-4.1-mini",
  input: relevantHistory
});
```

### Token Usage Estimation

**Typical conversation costs:**
```
Initial document upload (5 pages): ~3,000 tokens
System prompt: ~500 tokens
Per turn:
  - User message: ~50-200 tokens
  - AI response: ~100-300 tokens
  - Structured output: ~200 tokens

10-turn conversation total: ~5,000 tokens input, ~2,000 tokens output

Cost with gpt-4.1-mini:
  Input: 5,000 * $0.15/1M = $0.00075
  Output: 2,000 * $0.60/1M = $0.0012
  Total: ~$0.002 per conversation
```

## References

### Official OpenAI Documentation

1. **Structured Outputs**
   - https://platform.openai.com/docs/guides/structured-outputs
   - Guarantees JSON schema adherence
   - Supports Zod, JSON Schema, and Pydantic
   - Use `strict: true` for 100% reliability

2. **Conversation State Management**
   - https://platform.openai.com/docs/guides/conversation-state
   - Three approaches: manual, Conversations API, previous_response_id
   - Conversations persist 30+ days by default
   - Context window limits: 128K tokens for gpt-4.1

3. **Responses API**
   - https://platform.openai.com/docs/api-reference/responses
   - Replaces deprecated Assistants API
   - Simpler mental model: input items → output items
   - Works with Conversations for state management

4. **Assistants Migration Guide**
   - https://platform.openai.com/docs/assistants/migration
   - Assistants API deprecated, shutdown August 26, 2026
   - Migration path: Assistants → Prompts, Threads → Conversations, Runs → Responses

5. **Prompt Engineering**
   - https://platform.openai.com/docs/guides/prompt-engineering
   - Message roles: developer, user, assistant
   - Few-shot learning with examples
   - XML/Markdown for structured prompts

6. **Pricing**
   - https://openai.com/api/pricing/
   - gpt-4.1-mini: $0.15/$0.60 per 1M tokens
   - Cached input: 75% discount
   - Batch API: 50% discount for async processing

### Vercel AI SDK Documentation

1. **Generating Structured Data**
   - https://ai-sdk.dev/docs/ai-sdk-core/generating-structured-data
   - `generateObject` and `streamObject` functions
   - Zod schema integration
   - Error handling and validation

2. **Chatbot with useChat Hook**
   - https://ai-sdk.dev/docs/ai-sdk-ui/chatbot
   - Real-time message streaming
   - Status management (submitted, streaming, ready, error)
   - Message persistence and state management

3. **Conversation State**
   - Examples of managing multi-turn conversations
   - Message history management
   - Custom transport configuration

### Key Takeaways from Documentation

**Structured Outputs:**
- Always use `strict: true` with `json_schema` type for guaranteed adherence
- All fields must be required (use `type: ["string", "null"]` for optional fields)
- `additionalProperties: false` is required
- Maximum 5,000 object properties, 10 levels of nesting
- First request with new schema has higher latency (caching afterward)

**Conversation Management:**
- Conversations API is the recommended approach for persistent state
- Manual message management gives more control but requires more code
- `previous_response_id` chaining is simpler but less flexible
- All approaches bill the full conversation history on each request

**Cost Optimization:**
- Prompt caching automatically applies when instructions are static
- Use cheaper models (nano/mini) for most tasks
- Only escalate to larger models when needed
- Batch API for non-interactive workloads

**Best Practices:**
- Use message roles properly (developer for system logic, user for inputs)
- Include examples in prompts for better results (few-shot learning)
- Implement proper error handling (NoObjectGeneratedError)
- Track token usage with message metadata
- Set appropriate context window limits

### Additional Resources

1. **OpenAI Cookbook - Structured Outputs**
   - https://cookbook.openai.com/examples/structured_outputs_intro
   - Practical examples and patterns

2. **OpenAI Cookbook - Multi-Agent Systems**
   - https://cookbook.openai.com/examples/structured_outputs_multi_agent
   - Building complex systems with structured outputs

3. **Community Resources**
   - Multi-turn conversation best practices: https://community.openai.com/t/multi-turn-conversation-best-practice/282349
   - Keep system prompts simple
   - Save history as user/assistant messages
   - Limit saved messages to control costs

---

*Document created: 2025-11-05*
*Purpose: Research for building conversational AI data collection system for SAFE agreement automation*
*Next steps: Implement POC with Responses API + Conversations API + Structured Outputs*
