'use client';

import { use, useEffect, useState } from 'react';
import { type Field } from '@/lib/types';

interface Draft {
  id: string;
  fields: Field[];
  collectedData: Record<string, string>;
  completeness: number;
  status: string;
  documentHtml: string;
  filledHtml?: string;
  filledDocUrl?: string;
  messages: Message[];
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

export default function DraftPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [rendering, setRendering] = useState(false);

  // Load draft
  useEffect(() => {
    loadDraft();
  }, [id]);

  const loadDraft = async () => {
    try {
      const res = await fetch(`/api/draft/${id}`);
      if (!res.ok) throw new Error('Failed to load draft');
      const data = await res.json();
      setDraft(data);

      // Load messages from database
      if (data.messages && Array.isArray(data.messages)) {
        setMessages(data.messages as Message[]);
      }
    } catch (error) {
      console.error('Failed to load draft:', error);
    } finally {
      setLoading(false);
    }
  };

  const sendMessage = async () => {
    if (!input.trim() || sending) return;

    const userMessage = input.trim();
    setInput('');
    setSending(true);

    // Optimistically add user message to UI for immediate feedback
    setMessages(prev => [...prev, { role: 'user', content: userMessage }]);

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: id, message: userMessage }),
      });

      if (!res.ok) throw new Error('Failed to send message');

      // Reload draft to get updated data and messages from database
      await loadDraft();
    } catch (error) {
      console.error('Failed to send message:', error);
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, something went wrong. Please try again.',
      }]);
    } finally {
      setSending(false);
    }
  };

  const handleRender = async () => {
    setRendering(true);
    try {
      const res = await fetch('/api/render', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ draftId: id }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.message || 'Failed to render document');
      }

      const data = await res.json();

      if (data.status === 'incomplete') {
        alert(`Please complete all required fields:\n\n${data.missingFields.join('\n')}`);
        return;
      }

      // Reload draft to get the filled document
      await loadDraft();

      // Scroll to preview
      document.getElementById('preview')?.scrollIntoView({ behavior: 'smooth' });
    } catch (error) {
      console.error('Failed to render:', error);
      alert(error instanceof Error ? error.message : 'Failed to render document');
    } finally {
      setRendering(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4" />
          <p className="text-gray-600">Loading your document...</p>
        </div>
      </div>
    );
  }

  if (!draft) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <p className="text-red-600 text-lg">Draft not found</p>
        </div>
      </div>
    );
  }

  const fields = draft.fields as Field[];
  const collectedData = draft.collectedData;
  const missingRequired = fields.filter(f => f.required && !collectedData[f.key]);

  return (
    <div className="h-screen flex flex-col bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-semibold text-gray-900">Document Assistant</h1>
          <div className="flex items-center gap-4">
            <div className="text-sm">
              <span className="text-gray-600">Progress:</span>
              <span className="ml-2 font-semibold text-blue-600">
                {draft.completeness}%
              </span>
            </div>
            <div className="w-48 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-500"
                style={{ width: `${draft.completeness}%` }}
              />
            </div>
          </div>
        </div>

        {/* Field chips */}
        {missingRequired.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            <span className="text-sm text-gray-600">Missing:</span>
            {missingRequired.slice(0, 5).map(field => (
              <span
                key={field.key}
                className="px-3 py-1 bg-yellow-100 text-yellow-800 text-sm rounded-full"
              >
                {field.label}
              </span>
            ))}
            {missingRequired.length > 5 && (
              <span className="px-3 py-1 bg-gray-100 text-gray-600 text-sm rounded-full">
                +{missingRequired.length - 5} more
              </span>
            )}
          </div>
        )}
      </header>

      {/* Main content */}
      <div className="flex-1 grid grid-cols-2 gap-6 p-6 overflow-hidden min-h-0">
        {/* Chat Panel */}
        <div className="flex flex-col bg-white rounded-lg shadow-lg min-h-0">
          <div className="p-4 border-b border-gray-200 flex-shrink-0">
            <h2 className="font-semibold text-gray-900">Conversation</h2>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 min-h-0">
            {messages.map((msg, idx) => (
              <div
                key={idx}
                className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-[80%] rounded-lg px-4 py-2 ${
                    msg.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-100 text-gray-900'
                  }`}
                >
                  <p className="text-sm whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}
            {sending && (
              <div className="flex justify-start">
                <div className="bg-gray-100 rounded-lg px-4 py-2">
                  <div className="flex space-x-2">
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="p-4 border-t border-gray-200 flex-shrink-0">
            <form
              onSubmit={(e) => {
                e.preventDefault();
                sendMessage();
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                disabled={sending}
                placeholder="Type your response..."
                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
              />
              <button
                type="submit"
                disabled={sending || !input.trim()}
                className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
              >
                Send
              </button>
            </form>
          </div>
        </div>

        {/* Preview Panel */}
        <div className="flex flex-col bg-white rounded-lg shadow-lg min-h-0" id="preview">
          <div className="p-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
            <h2 className="font-semibold text-gray-900">Document Preview</h2>
            {draft.completeness === 100 && !draft.filledDocUrl && (
              <button
                onClick={handleRender}
                disabled={rendering}
                className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 disabled:bg-gray-400 transition-colors"
              >
                {rendering ? 'Rendering...' : 'Generate Document'}
              </button>
            )}
            {draft.filledDocUrl && (
              <a
                href={draft.filledDocUrl}
                download
                className="px-4 py-2 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700 transition-colors"
              >
                Download DOCX
              </a>
            )}
          </div>

          <div className="flex-1 overflow-y-auto p-6 min-h-0">
            <div
              className="prose max-w-none"
              dangerouslySetInnerHTML={{
                __html: draft.filledHtml || highlightFields(draft.documentHtml, fields, collectedData),
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

// Helper to highlight filled vs unfilled fields
function highlightFields(
  html: string,
  fields: Field[],
  collectedData: Record<string, string>
): string {
  let result = html;

  for (const field of fields) {
    const value = collectedData[field.key];
    const pattern = new RegExp(`\\[${escapeRegExp(field.label)}\\]`, 'g');

    if (value) {
      // Highlight filled fields in green
      result = result.replace(
        pattern,
        `<span class="bg-green-100 text-green-800 px-1 rounded">${value}</span>`
      );
    } else {
      // Highlight missing fields in yellow
      result = result.replace(
        pattern,
        `<span class="bg-yellow-100 text-yellow-800 px-1 rounded">[${field.label}]</span>`
      );
    }
  }

  return result;
}

function escapeRegExp(string: string): string {
  return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
