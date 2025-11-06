# Lexsy Document Automation POC

AI-powered legal document automation system for SAFE agreements. Built for the Lexsy take-home assignment.

## Features

- 📄 **Document Upload**: Drag-and-drop .docx file upload
- 🤖 **AI Field Detection**: Automatically identifies placeholders using GPT-4o-mini
- 💬 **Conversational Data Collection**: Natural chat interface to fill missing data
- ✅ **Self-Validating AI**: Confidence scoring and ambiguity detection
- 📊 **Live Preview**: Real-time document preview with highlighted fields
- ⬇️ **Document Export**: Download completed .docx files

## Tech Stack

- **Frontend**: Next.js 15, React 19, TailwindCSS
- **Backend**: Next.js API Routes
- **Database**: PostgreSQL + Prisma ORM
- **AI**: OpenAI API (Responses API + Conversations API)
- **Storage**: Vercel Blob
- **Deployment**: Vercel

## Getting Started

### Prerequisites
- Node.js 20+
- PostgreSQL database (or Vercel Postgres)
- OpenAI API key
- Vercel account (for Blob storage)

### Installation

1. **Clone and install**
   ```bash
   git clone <repo-url>
   cd lexsy-app
   npm install
   ```

2. **Setup environment variables**
   ```bash
   cp .env.example .env
   ```

   Edit `.env`:
   ```env
   OPENAI_API_KEY=sk-...
   DATABASE_URL=postgresql://...
   BLOB_READ_WRITE_TOKEN=...
   ```

3. **Setup database**
   ```bash
   npx prisma db push
   npx prisma generate
   ```

4. **Run development server**
   ```bash
   npm run dev
   ```

   Open [http://localhost:3000](http://localhost:3000)

## Architecture

See `/research` folder for detailed AI implementation patterns and conversation management strategies.

## Demo

Built with AI-powered conversational document completion using OpenAI's Responses API + Conversations API.

Cost per document: < $0.006
