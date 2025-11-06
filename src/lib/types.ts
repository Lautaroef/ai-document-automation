import { z } from 'zod';

// Field types
export const FieldSchema = z.object({
  key: z.string(),
  label: z.string(),
  type: z.enum(['text', 'money', 'date', 'jurisdiction']),
  required: z.boolean(),
  question: z.string(),
  example: z.string(),
  validationHint: z.string().optional(),
});

export type Field = z.infer<typeof FieldSchema>;

// Fields extraction response (from document parsing)
export const FieldsExtractionSchema = z.object({
  fields: z.array(FieldSchema),
  confidence: z.object({
    overall: z.enum(['high', 'medium', 'low']),
    reasoning: z.string(),
  }),
});

export type FieldsExtraction = z.infer<typeof FieldsExtractionSchema>;

// Conversation response (from chat API)
export const ConversationResponseSchema = z.object({
  messageType: z.enum(['document_info', 'general_chat', 'greeting']),
  conversationalResponse: z.string(),
  extractedData: z.record(z.string(), z.string()),
  confidenceLevel: z.enum(['high', 'medium', 'low']),
  confidenceReasoning: z.string(),
  nextQuestion: z.string().nullable(),
  missingFields: z.array(z.string()),
  isComplete: z.boolean(),
  needsClarification: z.boolean(),
  clarificationQuestion: z.string().nullable(),
});

export type ConversationResponse = z.infer<typeof ConversationResponseSchema>;

// Draft status
export type DraftStatus = 'parsing' | 'collecting' | 'complete';
