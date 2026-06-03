// Client transport for the "Vayu" chat assistant: POSTs to the Supabase Edge
// Function `chat` and reads its Server-Sent-Events stream (token / tool_call /
// error / done). Uses a direct fetch (NOT supabase.functions.invoke(), which
// buffers the whole body and cannot stream).

const SUPA_URL = import.meta.env.VITE_SUPABASE_URL as string;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
const CHAT_URL = `${(SUPA_URL || '').replace('.supabase.co', '.functions.supabase.co')}/chat`;

export interface ChatMessage { role: 'user' | 'model'; content: string; }
export interface ToolCall { name: string; args: Record<string, unknown>; }
export interface ToolResult { name: string; args: Record<string, unknown>; response: unknown; }

export interface StreamChatOpts {
  messages: ChatMessage[];
  context: unknown;
  toolsEnabled?: boolean;
  toolResult?: ToolResult | null;
  signal?: AbortSignal;
  onToken: (t: string) => void;
  onToolCall: (tc: ToolCall) => void;
  onDone: (finishReason: string) => void;
  onError: (code: string) => void;
}

export async function streamChat(opts: StreamChatOpts): Promise<void> {
  const { messages, context, toolsEnabled = true, toolResult = null, signal } = opts;
  let resp: Response;
  try {
    resp = await fetch(CHAT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${ANON}` },
      body: JSON.stringify({ messages, context, tools_enabled: toolsEnabled, tool_result: toolResult }),
      signal,
    });
  } catch (e) {
    if ((e as Error)?.name === 'AbortError') return;
    opts.onError('network');
    return;
  }
  if (!resp.ok || !resp.body) {
    opts.onError(resp.status === 503 ? 'unavailable' : 'error');
    return;
  }

  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const events = buf.split('\n\n');
      buf = events.pop() ?? '';
      for (const evt of events) {
        let event = '';
        let data = '';
        for (const line of evt.split('\n')) {
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data += line.slice(5).trim();
        }
        if (!event) continue;
        let parsed: Record<string, unknown> = {};
        try { parsed = data ? JSON.parse(data) : {}; } catch { continue; }
        if (event === 'token') opts.onToken(String(parsed.t ?? ''));
        else if (event === 'tool_call') opts.onToolCall({ name: String(parsed.name), args: (parsed.args as Record<string, unknown>) ?? {} });
        else if (event === 'error') opts.onError(String(parsed.message ?? 'error'));
        else if (event === 'done') opts.onDone(String(parsed.finishReason ?? 'STOP'));
      }
    }
  } catch (e) {
    if ((e as Error)?.name !== 'AbortError') opts.onError('stream');
  }
}
