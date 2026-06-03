// "Vayu" — Breeva's AI chat assistant. Lazy-loaded bottom sheet (out of the main
// bundle). Streams Gemini token-by-token via the Supabase Edge proxy, grounded in
// live AQI/route/profile context, and ACTIONABLE via function-calling tools that
// drive the real map (find clean route, check air, exposure, mode, stats).

import { useState, useRef, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Sparkles, X, ArrowUp, Square, Trash2, Wind, Navigation, BarChart3 } from 'lucide-react';
import { useMapStore } from '../../stores/mapStore';
import { useI18nStore } from '../../stores/i18nStore';
import { streamChat, type ChatMessage } from '../../lib/chat';
import { buildChatContext } from '../../lib/chat-context';
import { CHAT_TOOL_EXECUTORS, type ToolUiAction } from '../../lib/chat-tools';

interface UiMsg { role: 'user' | 'assistant'; text: string; streaming?: boolean; action?: ToolUiAction; }

const HISTORY_KEY = 'breeva_chat_history';
const aqiColor = (a: number) => (a <= 50 ? '#10b981' : a <= 100 ? '#f59e0b' : a <= 150 ? '#f97316' : '#ef4444');

/** Minimal markdown: **bold**, line breaks, "- " bullets. No dependency. */
function renderLite(text: string): ReactNode {
  return text.split('\n').map((line, i) => {
    const bullet = /^\s*-\s+/.test(line);
    const content = line.replace(/^\s*-\s+/, '');
    const parts = content.split(/(\*\*[^*]+\*\*)/g).map((p, j) =>
      p.startsWith('**') && p.endsWith('**') ? <strong key={j}>{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>,
    );
    return (
      <span key={i} className={bullet ? 'flex gap-1.5' : 'block'}>
        {bullet && <span className="text-primary-500">•</span>}
        <span>{parts}</span>
      </span>
    );
  });
}

const toApi = (m: UiMsg[]): ChatMessage[] =>
  m.filter((x) => x.text.trim()).map((x) => ({ role: x.role === 'user' ? 'user' : 'model', content: x.text }));

export default function ChatAssistant({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const { t } = useI18nStore(); // whole-store subscription → re-renders (and re-translates) on locale change
  const reduce = useReducedMotion() ?? false;
  const currentAQI = useMapStore((s) => s.currentAQI);

  const [open, setOpen] = useState(true);
  const [messages, setMessages] = useState<UiMsg[]>(() => {
    try { const raw = localStorage.getItem(HISTORY_KEY); if (raw) return JSON.parse(raw); } catch { /* ignore */ }
    return [];
  });
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const close = () => { abortRef.current?.abort(); setOpen(false); };

  // Persist + autoscroll
  useEffect(() => {
    try { localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-30))); } catch { /* ignore */ }
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);
  useEffect(() => () => abortRef.current?.abort(), []);

  const patchLast = (text: string, opts?: { streaming?: boolean; action?: ToolUiAction }) =>
    setMessages((prev) => {
      const next = [...prev];
      const last = next[next.length - 1];
      if (last && last.role === 'assistant') next[next.length - 1] = { ...last, text, streaming: opts?.streaming ?? last.streaming, action: opts?.action ?? last.action };
      return next;
    });

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || streaming) return;
    setInput('');
    abortRef.current?.abort();
    const history: UiMsg[] = [...messages, { role: 'user', text }];
    setMessages([...history, { role: 'assistant', text: '', streaming: true }]);
    setStreaming(true);

    const apiMessages = toApi(history);
    let assistantText = '';
    let toolCall: { name: string; args: Record<string, unknown> } | null = null;

    const ac1 = new AbortController(); abortRef.current = ac1;
    await streamChat({
      messages: apiMessages, context: buildChatContext(), toolsEnabled: true, signal: ac1.signal,
      onToken: (tk) => { assistantText += tk; patchLast(assistantText, { streaming: true }); },
      onToolCall: (tc) => { toolCall = tc; },
      onError: () => { if (!assistantText) patchLast(t('chat.error'), { streaming: false }); },
      onDone: () => { /* handled after await */ },
    });

    // Action turn: model asked to call a tool → run it, then stream the summary.
    if (toolCall) {
      const call = toolCall as { name: string; args: Record<string, unknown> };
      patchLast(assistantText, { streaming: true }); // keep typing indicator while acting
      let response: unknown = { error: 'unknown tool' };
      let ui: ToolUiAction | undefined;
      try {
        const exec = CHAT_TOOL_EXECUTORS[call.name];
        if (exec) { const out = await exec(call.args); response = out.response; ui = out.ui; }
      } catch { response = { error: 'action failed' }; }

      let followText = '';
      const ac2 = new AbortController(); abortRef.current = ac2;
      await streamChat({
        messages: apiMessages, context: buildChatContext(), toolsEnabled: false,
        toolResult: { name: call.name, args: call.args, response }, signal: ac2.signal,
        onToken: (tk) => { followText += tk; patchLast(followText, { streaming: true, action: ui }); },
        onToolCall: () => {},
        onError: () => { if (!followText) patchLast(t('chat.error'), { streaming: false, action: ui }); },
        onDone: () => {},
      });
      patchLast(followText || assistantText || t('chat.done'), { streaming: false, action: ui });
    } else {
      patchLast(assistantText || t('chat.error'), { streaming: false });
    }
    setStreaming(false);
  }

  function runAction(action: ToolUiAction) {
    if (action.kind === 'showRoute') { useMapStore.getState().setBottomSheetState('half'); close(); }
    else if (action.kind === 'openPaparan') { close(); navigate('/paparan'); }
  }

  const suggestions = [
    { key: 'safe', label: t('chat.suggest_safe') },
    { key: 'route', label: t('chat.suggest_route') },
    { key: 'aqi', label: t('chat.suggest_aqi') },
    { key: 'exposure', label: t('chat.suggest_exposure') },
  ];

  const aqiPill = currentAQI ? (
    <span className="inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold text-white" style={{ background: aqiColor(currentAQI.aqi) }}>
      AQI {currentAQI.aqi}
    </span>
  ) : null;

  return (
    <AnimatePresence onExitComplete={onClose}>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-50 bg-black/30 backdrop-blur-[2px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />
          <motion.div
            className="fixed bottom-0 left-0 right-0 md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-md md:bottom-20 z-50 flex flex-col bg-white dark:bg-gray-900 rounded-t-3xl md:rounded-3xl shadow-[0_-10px_40px_-15px_rgba(0,0,0,0.2)] md:shadow-2xl md:border border-gray-100 dark:border-gray-800 h-[80vh] md:h-[600px] max-h-[80vh] overflow-hidden"
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={{ type: 'spring', damping: 30, stiffness: 300 }}
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100 dark:border-gray-800">
              <div className="w-9 h-9 rounded-xl gradient-primary flex items-center justify-center flex-shrink-0 shadow-sm">
                <Sparkles className="w-5 h-5 text-white" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <h2 className="text-sm font-bold text-gray-900 dark:text-white">Vayu</h2>
                  {aqiPill}
                </div>
                <p className="text-[10px] text-gray-400 dark:text-gray-500">{t('chat.tagline')}</p>
              </div>
              {messages.length > 0 && (
                <button onClick={() => { localStorage.removeItem(HISTORY_KEY); setMessages([]); }}
                  className="p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label={t('chat.clear')}>
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button onClick={close} className="p-1.5 rounded-lg text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-800" aria-label={t('common.cancel')}>
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-3 space-y-3">
              {messages.length === 0 && (
                <div className="flex flex-col items-center text-center pt-6 pb-2">
                  <div className="w-14 h-14 rounded-2xl gradient-primary flex items-center justify-center mb-3 shadow-md">
                    <Sparkles className="w-7 h-7 text-white" />
                  </div>
                  <p className="text-sm font-semibold text-gray-900 dark:text-white">{t('chat.greeting_title')}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 max-w-[260px]">
                    {currentAQI ? t('chat.greeting_aqi', { aqi: currentAQI.aqi, level: currentAQI.level }) : t('chat.greeting_generic')}
                  </p>
                </div>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                  <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed ${
                    m.role === 'user'
                      ? 'bg-primary-500 text-white rounded-br-md'
                      : 'bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-100 rounded-bl-md'
                  }`}>
                    <div className="space-y-1">
                      {m.text ? renderLite(m.text) : null}
                      {m.streaming && <span className="inline-block w-1.5 h-3.5 bg-current opacity-60 animate-pulse align-middle ml-0.5" />}
                    </div>
                    {m.action && !m.streaming && (
                      <button onClick={() => runAction(m.action!)}
                        className="mt-2 inline-flex items-center gap-1.5 rounded-lg bg-white/15 dark:bg-white/10 hover:bg-white/25 text-[11px] font-bold px-2.5 py-1.5 text-primary-600 dark:text-primary-300 bg-primary-50 dark:bg-primary-900/30">
                        {m.action.kind === 'showRoute' ? <Navigation className="w-3.5 h-3.5" /> : <BarChart3 className="w-3.5 h-3.5" />}
                        {m.action.kind === 'showRoute' ? `${t('chat.action_route')}${m.action.label ? ` · ${m.action.label}` : ''}` : t('chat.action_paparan')}
                      </button>
                    )}
                  </div>
                </div>
              ))}
            </div>

            {/* Suggested chips (empty state) */}
            {messages.length === 0 && (
              <div className="px-4 pb-2 flex flex-wrap gap-2">
                {suggestions.map((s) => (
                  <button key={s.key} onClick={() => send(s.label)}
                    className="text-[11px] font-medium px-2.5 py-1.5 rounded-full border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:border-primary-300 hover:bg-primary-50 dark:hover:bg-primary-900/20 transition">
                    {s.label}
                  </button>
                ))}
              </div>
            )}

            {/* Composer */}
            <div className="px-3 py-3 border-t border-gray-100 dark:border-gray-800 safe-area-bottom">
              <div className="flex items-end gap-2 rounded-2xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 px-3 py-2 focus-within:border-primary-400">
                <Wind className="w-4 h-4 text-primary-400 flex-shrink-0 mb-1.5" />
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                  rows={1}
                  placeholder={t('chat.placeholder')}
                  className="flex-1 resize-none bg-transparent text-[13px] text-gray-900 dark:text-white placeholder:text-gray-400 outline-none max-h-24 py-1"
                />
                {streaming ? (
                  <button onClick={() => abortRef.current?.abort()} className="w-8 h-8 rounded-xl bg-gray-300 dark:bg-gray-600 flex items-center justify-center flex-shrink-0" aria-label={t('chat.stop')}>
                    <Square className="w-3.5 h-3.5 text-white fill-white" />
                  </button>
                ) : (
                  <button onClick={() => send(input)} disabled={!input.trim()}
                    className="w-8 h-8 rounded-xl bg-primary-500 disabled:opacity-40 flex items-center justify-center flex-shrink-0 transition" aria-label={t('chat.send')}>
                    <ArrowUp className="w-4 h-4 text-white" />
                  </button>
                )}
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
