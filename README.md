# AI-Powered Legal Document Assistant

A production-ready web application that uses AI to intelligently fill legal documents through natural conversation.

## 🎯 Overview

This application transforms the tedious process of filling legal documents into a natural, conversational experience. Upload a SAFE agreement, chat with an AI assistant to provide the required information, and download a completed document - all in minutes.

### Key Features

- **🤖 AI-Powered Field Detection**: Automatically identifies placeholders in legal documents using GPT-4o-mini
- **💬 Natural Conversation Flow**: Handles greetings, off-topic questions, and gracefully guides users back to document completion
- **🔄 Smart Data Extraction**: Detects whether users are providing document information vs. casual chat
- **✏️ Error Correction**: Update any field at any time - the AI handles corrections naturally
- **💾 Persistent Conversations**: Full chat history saved - reload the page without losing context
- **📊 Real-time Progress**: Visual progress tracking with field completion status
- **📄 Live Preview**: See your document update in real-time as you provide information
- **⬇️ One-Click Download**: Generate and download completed DOCX files instantly

## 🛠 Tech Stack

### Frontend
- **Next.js 15** - React framework with App Router
- **TypeScript** - Type-safe development
- **Tailwind CSS** - Utility-first styling

### Backend
- **Next.js API Routes** - Serverless API endpoints
- **Prisma** - Type-safe database ORM
- **PostgreSQL (Supabase)** - Production database
- **Vercel Blob** - Document storage

### AI & Processing
- **OpenAI GPT-4o-mini** - Conversational AI and field extraction
- **OpenAI Responses API** - Structured outputs with JSON schemas
- **OpenAI Conversations API** - Native conversation state management
- **Vercel AI SDK** - Simplified AI integration
- **Mammoth.js** - DOCX to HTML parsing
- **html-to-docx** - HTML to DOCX generation

### Validation & Type Safety
- **Zod** - Runtime type validation and schema validation

## 🏗 Architecture

### Two-Phase AI Approach

#### Phase 1: Document Analysis (Upload)
1. User uploads `.docx` file
2. Parse document to HTML and plain text using Mammoth.js
3. AI analyzes document and extracts:
   - Field definitions (name, type, validation rules)
   - Natural questions to ask users
   - Example values for each field
   - Confidence assessment

#### Phase 2: Conversational Data Collection (Chat)
1. AI asks questions one at a time
2. User responds naturally (can chat, ask questions, make mistakes)
3. AI extracts data and determines message type:
   - `greeting`: User saying hello → respond friendly, guide to task
   - `general_chat`: Off-topic → acknowledge politely, redirect
   - `document_info`: Actual data → extract, confirm, ask next
4. Conversation state managed automatically by OpenAI
5. Progress tracked in real-time
6. All messages persisted to database

### Smart Conversation Handling

The AI uses a custom response schema that includes:
- **Message Type Classification**: Detects intent (greeting/chat/data)
- **Conversational Responses**: Natural, friendly replies
- **Confidence Levels**: Assesses extraction quality
- **Clarification Logic**: Asks for confirmation when unsure
- **Graceful Redirection**: Handles off-topic conversations professionally

### Database Schema

```prisma
model Draft {
  id              String   @id @default(cuid())

  // Document storage
  originalDocUrl  String   // Vercel Blob URL
  documentHtml    String   @db.Text
  documentText    String   @db.Text

  // AI-detected fields
  fields          Json     // Field definitions with metadata

  // Conversation state
  openaiConvId    String   @unique // OpenAI Conversation ID
  collectedData   Json     @default("{}")
  messages        Json     @default("[]") // Chat history

  // Progress tracking
  status          String   @default("parsing")
  completeness    Int      @default(0) // 0-100%

  // Output
  filledHtml      String?  @db.Text
  filledDocUrl    String?

  createdAt       DateTime @default(now())
  updatedAt       DateTime @updatedAt
}
```

## 🚀 Setup Instructions

### Prerequisites

- Node.js 18+
- npm or yarn
- PostgreSQL database (Supabase recommended)
- OpenAI API key
- Vercel account (for Blob storage)

### 1. Clone and Install

```bash
git clone <your-repo-url>
cd ai-doc-fill
npm install
```

### 2. Environment Variables

Create a `.env` file in the root directory:

```env
# OpenAI API Key
OPENAI_API_KEY=sk-proj-...

# Database URLs (from Supabase)
DATABASE_URL="postgresql://user:password@host:6543/postgres?pgbouncer=true"
DIRECT_URL="postgresql://user:password@host:5432/postgres"

# Vercel Blob Storage Token
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...

# App URL
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

**Important**: If your database password contains special characters (like `#`), make sure to URL-encode them:
- `#` → `%23`
- `@` → `%40`
- `&` → `%26`

### 3. Database Setup

Push the Prisma schema to your database:

```bash
npx prisma db push
npx prisma generate
```

### 4. Run Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) to see the app.

## 📦 Deployment (Vercel)

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit"
git remote add origin <your-github-repo-url>
git push -u origin main
```

### 2. Deploy to Vercel

1. Go to [vercel.com](https://vercel.com)
2. Click "New Project"
3. Import your GitHub repository
4. Add environment variables:
   - `OPENAI_API_KEY`
   - `DATABASE_URL`
   - `DIRECT_URL`
   - `BLOB_READ_WRITE_TOKEN`
5. Click "Deploy"

### 3. Vercel Blob Setup

If you don't have a Blob storage token yet:

1. Go to your Vercel project dashboard
2. Navigate to "Storage" tab
3. Create a new Blob store
4. Copy the `BLOB_READ_WRITE_TOKEN`
5. Add it to your environment variables

## 📝 API Documentation

### POST `/api/upload`

Upload and analyze a SAFE agreement document.

**Request:**
- Content-Type: `multipart/form-data`
- Body: `file` (`.docx` file, max 10MB)

**Response:**
```json
{
  "draftId": "cmhmy2ere00005gydwi1jysa2",
  "fields": [
    {
      "key": "company_name",
      "label": "Company Name",
      "type": "text",
      "required": true,
      "question": "What's the name of the company?",
      "example": "e.g., Acme Corp"
    }
  ],
  "confidence": {
    "overall": "high",
    "reasoning": "All placeholders clearly identified"
  },
  "initialMessage": "Great! I've analyzed your SAFE agreement..."
}
```

### POST `/api/chat`

Send a message in the conversation.

**Request:**
```json
{
  "draftId": "cmhmy2ere00005gydwi1jysa2",
  "message": "The company name is Acme Corp"
}
```

**Response:**
```json
{
  "message": "Perfect! I've recorded Acme Corp. What's the investor name?",
  "messageType": "document_info",
  "extractedData": {
    "company_name": "Acme Corp"
  },
  "completeness": 17,
  "isComplete": false
}
```

### POST `/api/render`

Generate the final DOCX document.

**Request:**
```json
{
  "draftId": "cmhmy2ere00005gydwi1jysa2"
}
```

**Response:**
```json
{
  "status": "success",
  "htmlPreview": "<html>...</html>",
  "docxUrl": "https://blob.vercel-storage.com/filled-xxx.docx"
}
```

### GET `/api/draft/:id`

Fetch draft details and conversation history.

**Response:**
```json
{
  "id": "cmhmy2ere00005gydwi1jysa2",
  "fields": [...],
  "collectedData": {
    "company_name": "Acme Corp"
  },
  "messages": [
    { "role": "assistant", "content": "Great! I've analyzed..." },
    { "role": "user", "content": "The company is Acme Corp" }
  ],
  "completeness": 17,
  "status": "collecting"
}
```

## 🎨 User Flow

1. **Upload**: User uploads SAFE agreement (.docx)
2. **Analysis**: AI extracts 6 fields (company name, investor, amount, cap, date, state)
3. **Conversation**:
   - AI asks: "What's the name of the company?"
   - User: "It's Acme Corp" ✅ or "Hello!" or "What's the weather?"
   - AI extracts data intelligently or redirects naturally
4. **Progress**: Real-time updates - 17%, 33%, 50%, 67%, 83%, 100%
5. **Review**: Live preview shows filled document with highlighted fields
6. **Download**: Click "Generate Document" → Download completed DOCX

## 🧪 Testing

### Manual Test Flow

1. **Upload**: Use the provided SAFE agreement sample
2. **Test Greetings**: Say "Hello" - AI should respond friendly
3. **Test Off-topic**: Ask "What's the weather?" - AI should redirect politely
4. **Test Data Entry**: Provide company name - AI should extract and confirm
5. **Test Corrections**: Change a previous answer - AI should update gracefully
6. **Test Completion**: Fill all fields - progress should reach 100%
7. **Test Reload**: Refresh page - conversation history should persist
8. **Test Rendering**: Generate document - should download valid DOCX

### Sample Test Data

```
Company Name: Acme Corp
Investor Name: John Doe
Purchase Amount: $100,000 (or "100k" - AI normalizes)
Valuation Cap: $5,000,000 (or "5 million")
Date: November 6, 2025 (or "11/6/2025" or "today")
State: Delaware (or "Delaware, USA")
```

## 💡 Design Decisions

### Why OpenAI Conversations API?

- **Native State Management**: No manual history tracking
- **Reduced Tokens**: More efficient than sending full history each time
- **Built-in Context**: Automatically maintains conversation context

### Why Non-Strict JSON Schema?

- **Dynamic Objects**: `extractedData` has variable keys (field names)
- **Flexibility**: Strict mode requires all properties to be explicitly defined
- **Validation**: We use Zod for runtime validation anyway

### Why Message Persistence?

- **User Experience**: Don't lose work on page refresh
- **Debugging**: Full audit trail of conversations
- **Resume Capability**: Users can come back later

### Why Two-Column Layout?

- **Context**: Users see the document while chatting
- **Feedback**: Real-time preview shows progress
- **Trust**: Transparency in what's being filled

## 🔮 Future Enhancements

### Short Term
- [ ] Support for multiple document types (not just SAFE)
- [ ] User authentication and saved documents
- [ ] Email notifications when document is ready
- [ ] Export to PDF in addition to DOCX

### Medium Term
- [ ] Multi-party signing workflow
- [ ] Template library for common agreements
- [ ] AI-powered document review and suggestions
- [ ] Integration with DocuSign/HelloSign

### Long Term
- [ ] Custom field extraction for any legal document
- [ ] Legal clause explanation and simplification
- [ ] Document comparison and version control
- [ ] Collaborative document editing

## 🎓 Lessons Learned

1. **OpenAI's strict mode limitations**: Dynamic objects require `strict: false`
2. **Next.js library compatibility**: Some npm packages don't work in serverless environments
3. **URL encoding matters**: Special characters in database URLs must be encoded
4. **Message persistence**: Critical for production UX
5. **AI can be conversational**: With proper prompt engineering and schema design

## 📊 Cost Analysis

**Per Document:**
- Field Extraction (Upload): ~$0.003
- Conversation (6 exchanges): ~$0.003
- **Total: ~$0.006 per completed SAFE agreement**

Scales to thousands of documents per day at minimal cost.

## 📄 License

MIT
