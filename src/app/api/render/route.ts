import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { prisma } from '@/lib/db';
import { type Field } from '@/lib/types';
// @ts-ignore - html-docx-js doesn't have types
import htmlDocx from 'html-docx-js';

export const runtime = 'nodejs';
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    const { draftId } = await req.json();

    if (!draftId) {
      return NextResponse.json(
        { error: 'Draft ID is required' },
        { status: 400 }
      );
    }

    console.log('[Render] Rendering draft:', draftId);

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

    // Check if all required fields are filled
    const requiredFields = fields.filter(f => f.required);
    const missingRequired = requiredFields.filter(f => !collectedData[f.key]);

    if (missingRequired.length > 0) {
      return NextResponse.json({
        status: 'incomplete',
        message: 'Some required fields are still missing',
        missingFields: missingRequired.map(f => f.label),
      });
    }

    // Replace placeholders in HTML
    let filledHtml = draft.documentHtml;

    for (const field of fields) {
      const value = collectedData[field.key] || '[MISSING]';

      // Try multiple patterns to catch all variations
      const patterns = [
        new RegExp(`\\[${escapeRegExp(field.label)}\\]`, 'g'),
        new RegExp(`\\[${escapeRegExp(field.key)}\\]`, 'gi'),
        // Handle money placeholders like $[_____]
        ...(field.type === 'money' ? [/\$\[\s*[_\s]+\s*\]/g] : []),
      ];

      for (const pattern of patterns) {
        filledHtml = filledHtml.replace(pattern, value);
      }
    }

    console.log('[Render] HTML filled successfully');

    // Generate DOCX from HTML
    const htmlDoc = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body {
      font-family: 'Times New Roman', serif;
      line-height: 1.5;
      margin: 1in;
    }
  </style>
</head>
<body>
  ${filledHtml}
</body>
</html>`;

    const docxBlob = htmlDocx.asBlob(htmlDoc);
    const docxBuffer = Buffer.from(await docxBlob.arrayBuffer());

    // Upload to Vercel Blob
    const blob = await put(`filled-${draftId}.docx`, docxBuffer, {
      access: 'public',
      contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    });

    console.log('[Render] DOCX uploaded to:', blob.url);

    // Update draft
    await prisma.draft.update({
      where: { id: draftId },
      data: {
        filledHtml,
        filledDocUrl: blob.url,
        status: 'complete',
      },
    });

    return NextResponse.json({
      status: 'success',
      htmlPreview: filledHtml,
      docxUrl: blob.url,
    });
  } catch (error) {
    console.error('[Render] Error:', error);
    return NextResponse.json(
      { error: 'Failed to render document. Please try again.' },
      { status: 500 }
    );
  }
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
