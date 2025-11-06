import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import mammoth from 'mammoth';
import { generateObject } from 'ai';
import { openai as openaiProvider } from '@ai-sdk/openai';
import { openai } from '@/lib/openai';
import { prisma } from '@/lib/db';
import { FieldsExtractionSchema } from '@/lib/types';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file') as File;

    if (!file) {
      return NextResponse.json(
        { error: 'No file provided' },
        { status: 400 }
      );
    }

    if (!file.name.endsWith('.docx')) {
      return NextResponse.json(
        { error: 'Only .docx files are supported' },
        { status: 400 }
      );
    }

    // Size limit: 10MB
    if (file.size > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: 'File size must be less than 10MB' },
        { status: 400 }
      );
    }

    console.log('[Upload] Processing file:', file.name);

    // 1. Store original in Vercel Blob
    const blob = await put(file.name, file, {
      access: 'public',
      contentType: file.type,
    });

    console.log('[Upload] File stored at:', blob.url);

    // 2. Parse DOCX to HTML and text
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    const { value: html } = await mammoth.convertToHtml({ buffer });
    const { value: text } = await mammoth.extractRawText({ buffer });

    console.log('[Upload] Document parsed, length:', text.length);

    // 3. Extract fields using AI
    console.log('[Upload] Extracting fields with AI...');

    const { object: extraction } = await generateObject({
      model: openaiProvider('gpt-4o-mini'),
      schema: FieldsExtractionSchema,
      prompt: `Analyze this SAFE agreement document and extract all placeholders that need to be filled.

Document text:
${text.slice(0, 8000)} ${text.length > 8000 ? '...(truncated)' : ''}

Instructions:
1. Identify ALL placeholders in brackets like [Company Name], [Investor Name], [Date], $[______], etc.
2. For each placeholder, determine:
   - A unique key (e.g., "company_name")
   - The display label (e.g., "Company Name")
   - The type: "text", "money", "date", or "jurisdiction"
   - Whether it's required (most are)
   - A natural question to ask the user (e.g., "What's the name of the company?")
   - An example value (e.g., "e.g., Acme Corp")
3. Assess your overall confidence in the extraction

Common SAFE agreement fields:
- Company Name
- Investor Name
- Purchase Amount (money)
- Valuation Cap (money)
- Date of Safe (date)
- State of Incorporation (jurisdiction)
- Governing Law Jurisdiction (jurisdiction)

Return a structured response with fields array and confidence assessment.`,
    });

    console.log('[Upload] Fields extracted:', extraction.fields.length);

    // 4. Create OpenAI Conversation
    const conversation = await openai.conversations.create({
      metadata: {
        purpose: 'safe-data-collection',
        fileName: file.name,
      },
    });

    console.log('[Upload] Conversation created:', conversation.id);

    // 5. Create Draft record
    const draft = await prisma.draft.create({
      data: {
        originalDocUrl: blob.url,
        documentHtml: html,
        documentText: text,
        fields: extraction.fields,
        openaiConvId: conversation.id,
        status: 'collecting',
        completeness: 0,
      },
    });

    console.log('[Upload] Draft created:', draft.id);

    // 6. Generate initial message
    const fieldCount = extraction.fields.length;
    const requiredFields = extraction.fields.filter(f => f.required);

    const initialMessage = `Great! I've analyzed your SAFE agreement and found ${fieldCount} fields that need to be filled${requiredFields.length < fieldCount ? ` (${requiredFields.length} required)` : ''}.

Let's collect the information together. ${extraction.fields[0]?.question || "Let's get started!"}`;

    return NextResponse.json({
      draftId: draft.id,
      fields: extraction.fields,
      confidence: extraction.confidence,
      initialMessage,
    });
  } catch (error) {
    console.error('[Upload] Error:', error);
    return NextResponse.json(
      { error: 'Failed to process document. Please try again.' },
      { status: 500 }
    );
  }
}
