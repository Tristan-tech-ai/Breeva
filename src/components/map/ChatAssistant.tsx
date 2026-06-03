// "Vayu" — Breeva's AI chat assistant. Lazy-loaded bottom sheet (out of the main
// bundle). Streams Gemini token-by-token via the Supabase Edge proxy, grounded in
// live AQI/route/profile context, and ACTIONABLE via function-calling tools that
// drive the real map (find clean route, check air, exposure, mode, stats).
//
// Visual direction: "aurora air" — a living, breathing assistant. Soft emerald→
// teal→cyan aura, refined glassmorphism, atmospheric depth, staggered motion.

import { useState, useRef, useEffect, type ReactNode, type ComponentType } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { Sparkles, X, ArrowUp, Square, Trash2, Wind, Navigation, BarChart3, Footprints, Activity } from 'lucide-react';
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
      p.startsWith('**') && p.endsWith('**') ? <strong key={j} className="font-bold">{p.slice(2, -2)}</strong> : <span key={j}>{p}</span>,
    );
    return (
      <span key={i} className={bullet ? 'flex gap-1.5' : 'block'}>
        {bullet && <span className="text-emerald-500 select-none">•</span>}
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

  const suggestions: { key: string; icon: ComponentType<{ className?: string }>; label: string }[] = [
    { key: 'safe', icon: Footprints, label: t('chat.suggest_safe') },
    { key: 'route', icon: Navigation, label: t('chat.suggest_route') },
    { key: 'aqi', icon: Wind, label: t('chat.suggest_aqi') },
    { key: 'exposure', icon: Activity, label: t('chat.suggest_exposure') },
  ];

  return (
    <AnimatePresence onExitComplete={onClose}>
      {open && (
        <>
          <motion.div className="fixed inset-0 z-50 bg-gray-900/30 backdrop-blur-[3px]"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={close} />

          <motion.div
            className="fixed bottom-0 left-0 right-0 md:left-1/2 md:-translate-x-1/2 md:w-full md:max-w-[26rem] md:bottom-20 z-50 flex flex-col overflow-hidden h-[82vh] md:h-[620px] max-h-[82vh]
                       rounded-t-[28px] md:rounded-[28px] border border-white/60 dark:border-white/10
                       bg-white/80 dark:bg-gray-900/85 backdrop-blur-2xl
                       shadow-[0_-12px_50px_-12px_rgba(13,148,136,0.25)] md:shadow-[0_24px_70px_-20px_rgba(13,148,136,0.4)]"
            initial={reduce ? { opacity: 0 } : { y: '100%' }}
            animate={reduce ? { opacity: 1 } : { y: 0 }}
            exit={reduce ? { opacity: 0 } : { y: '100%' }}
            transition={{ type: 'spring', damping: 32, stiffness: 320 }}
          >
            {/* Atmospheric aurora wash (top) */}
            <div aria-hidden className="pointer-events-none absolute -top-24 left-1/2 -translate-x-1/2 w-[120%] h-56 rounded-full blur-3xl opacity-70 dark:opacity-40"
              style={{ background: 'radial-gradient(closest-side, rgba(16,185,129,0.35), rgba(20,184,166,0.22) 55%, transparent)' }} />
            {/* Mobile drag handle */}
            <div className="md:hidden relative pt-2.5 flex justify-center">
              <span className="h-1 w-10 rounded-full bg-gray-300/80 dark:bg-gray-600/80" />
            </div>

            {/* Header */}
            <div className="relative flex items-center gap-3 px-4 pt-3 pb-3">
              <div className="relative flex-shrink-0">
                {!reduce && (
                  <motion.span aria-hidden className="absolute -inset-1.5 rounded-2xl blur-md"
                    style={{ background: 'linear-gradient(135deg,#34d399,#2dd4bf,#22d3ee)' }}
                    animate={{ opacity: [0.35, 0.6, 0.35], scale: [0.95, 1.05, 0.95] }}
                    transition={{ repeat: Infinity, duration: 3.4, ease: 'easeInOut' }} />
                )}
                <div className="relative w-10 h-10 rounded-2xl flex items-center justify-center shadow-md"
                  style={{ background: 'linear-gradient(135deg,#10b981,#14b8a6,#06b6d4)' }}>
                  <Sparkles className="w-5 h-5 text-white" strokeWidth={2.2} />
                </div>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <h2 className="text-[15px] font-extrabold tracking-tight text-gray-900 dark:text-white">Vayu</h2>
                  {currentAQI && (
                    <span className="inline-flex items-center gap-1 rounded-full pl-1.5 pr-2 py-0.5 text-[10px] font-bold text-white shadow-sm" style={{ background: aqiColor(currentAQI.aqi) }}>
                      <span className="relative flex w-1.5 h-1.5">
                        <span className="absolute inline-flex w-full h-full rounded-full bg-white opacity-70 animate-ping" />
                        <span className="relative inline-flex w-1.5 h-1.5 rounded-full bg-white" />
                      </span>
                      AQI {currentAQI.aqi}
                    </span>
                  )}
                </div>
                <p className="text-[10.5px] text-gray-400 dark:text-gray-500 -mt-0.5">{t('chat.tagline')}</p>
              </div>
              {messages.length > 0 && (
                <button onClick={() => { localStorage.removeItem(HISTORY_KEY); setMessages([]); }}
                  className="p-2 rounded-xl text-gray-400 hover:text-gray-600 hover:bg-gray-100/80 dark:hover:bg-white/10 transition" aria-label={t('chat.clear')}>
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
              <button onClick={close} className="p-2 rounded-xl text-gray-500 hover:text-gray-700 hover:bg-gray-100/80 dark:hover:bg-white/10 transition" aria-label={t('common.cancel')}>
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="h-px bg-gradient-to-r from-transparent via-gray-200/70 dark:via-white/10 to-transparent" />

            {/* Messages */}
            <div ref={scrollRef} className="relative flex-1 overflow-y-auto overscroll-contain px-4 py-4 space-y-3 scrollbar-hide">
              {messages.length === 0 && (
                <div className="flex flex-col items-center text-center pt-7 pb-3">
                  <div className="relative mb-4">
                    {!reduce && (
                      <motion.span aria-hidden className="absolute -inset-3 rounded-full blur-xl"
                        style={{ background: 'radial-gradient(closest-side, rgba(45,212,191,0.55), transparent)' }}
                        animate={{ opacity: [0.4, 0.65, 0.4], scale: [1, 1.18, 1] }}
                        transition={{ repeat: Infinity, duration: 3.6, ease: 'easeInOut' }} />
                    )}
                    <div className="relative w-[68px] h-[68px] rounded-[1.6rem] flex items-center justify-center shadow-xl"
                      style={{ background: 'linear-gradient(135deg,#10b981,#14b8a6,#06b6d4)' }}>
                      <Sparkles className="w-8 h-8 text-white" strokeWidth={2} />
                    </div>
                  </div>
                  <p className="text-base font-extrabold text-gray-900 dark:text-white">{t('chat.greeting_title')}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1.5 max-w-[270px] leading-relaxed">
                    {currentAQI ? t('chat.greeting_aqi', { aqi: currentAQI.aqi, level: currentAQI.level }) : t('chat.greeting_generic')}
                  </p>
                </div>
              )}

              {messages.map((m, i) => (
                <motion.div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}
                  initial={reduce ? false : { opacity: 0, y: 8, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }}
                  transition={{ type: 'spring', damping: 26, stiffness: 320 }}>
                  <div className={`max-w-[86%] px-3.5 py-2.5 text-[13px] leading-relaxed shadow-sm ${
                    m.role === 'user'
                      ? 'rounded-[18px] rounded-br-md text-white'
                      : 'rounded-[18px] rounded-bl-md bg-white/90 dark:bg-gray-800/90 text-gray-800 dark:text-gray-100 border border-gray-100 dark:border-white/5 backdrop-blur-sm'
                  }`}
                    style={m.role === 'user' ? { background: 'linear-gradient(135deg,#10b981,#0d9488)' } : undefined}>
                    {m.text ? (
                      <div className="space-y-1">
                        {renderLite(m.text)}
                        {m.streaming && <span className="inline-block w-[3px] h-3.5 rounded-full bg-current opacity-60 align-middle ml-0.5 animate-pulse" />}
                      </div>
                    ) : m.streaming ? (
                      <span className="flex items-center gap-1 py-0.5">
                        {[0, 1, 2].map((d) => (
                          <motion.span key={d} className="w-1.5 h-1.5 rounded-full bg-teal-400"
                            animate={reduce ? undefined : { opacity: [0.3, 1, 0.3], y: [0, -2, 0] }}
                            transition={{ repeat: Infinity, duration: 0.9, delay: d * 0.15 }} />
                        ))}
                      </span>
                    ) : null}

                    {m.action && !m.streaming && (
                      <button onClick={() => runAction(m.action!)}
                        className="mt-2.5 inline-flex items-center gap-1.5 rounded-xl text-[11px] font-bold px-3 py-1.5 text-white shadow-sm hover:shadow-md hover:scale-[1.02] active:scale-95 transition"
                        style={{ background: 'linear-gradient(135deg,#10b981,#0891b2)' }}>
                        {m.action.kind === 'showRoute' ? <Navigation className="w-3.5 h-3.5" /> : <BarChart3 className="w-3.5 h-3.5" />}
                        {m.action.kind === 'showRoute' ? `${t('chat.action_route')}${m.action.label ? ` · ${m.action.label}` : ''}` : t('chat.action_paparan')}
                      </button>
                    )}
                  </div>
                </motion.div>
              ))}
            </div>

            {/* Suggested chips (empty state) */}
            {messages.length === 0 && (
              <div className="px-4 pb-2.5 grid grid-cols-2 gap-2">
                {suggestions.map((s, idx) => (
                  <motion.button key={s.key} onClick={() => send(s.label)}
                    initial={reduce ? false : { opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: reduce ? 0 : 0.06 * idx + 0.1 }}
                    className="group flex items-center gap-2 text-left text-[11.5px] font-semibold px-3 py-2.5 rounded-2xl border border-gray-200/80 dark:border-white/10 bg-white/70 dark:bg-white/5 text-gray-700 dark:text-gray-200 hover:border-emerald-300 hover:bg-emerald-50/80 dark:hover:bg-emerald-900/20 hover:shadow-sm transition">
                    <span className="w-6 h-6 rounded-lg bg-emerald-100/80 dark:bg-emerald-900/40 flex items-center justify-center flex-shrink-0 group-hover:bg-emerald-200 dark:group-hover:bg-emerald-800/50 transition">
                      <s.icon className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    </span>
                    <span className="leading-tight">{s.label}</span>
                  </motion.button>
                ))}
              </div>
            )}

            {/* Composer */}
            <div className="px-3 py-3 safe-area-bottom">
              <div className="flex items-end gap-2 rounded-[20px] border border-gray-200 dark:border-white/10 bg-white/80 dark:bg-gray-800/70 backdrop-blur px-3 py-2 transition-all focus-within:border-emerald-400 focus-within:ring-2 focus-within:ring-emerald-400/25 focus-within:shadow-[0_0_0_4px_rgba(16,185,129,0.06)]">
                <Wind className="w-4 h-4 text-teal-400 flex-shrink-0 mb-1.5" />
                <textarea
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); } }}
                  rows={1}
                  placeholder={t('chat.placeholder')}
                  className="flex-1 resize-none bg-transparent text-[13px] text-gray-900 dark:text-white placeholder:text-gray-400 outline-none max-h-24 py-1"
                />
                {streaming ? (
                  <button onClick={() => abortRef.current?.abort()}
                    className="w-9 h-9 rounded-2xl bg-gray-200 dark:bg-gray-600 flex items-center justify-center flex-shrink-0 hover:bg-gray-300 dark:hover:bg-gray-500 active:scale-90 transition" aria-label={t('chat.stop')}>
                    <Square className="w-3.5 h-3.5 text-gray-600 dark:text-gray-200 fill-current" />
                  </button>
                ) : (
                  <button onClick={() => send(input)} disabled={!input.trim()}
                    className="w-9 h-9 rounded-2xl flex items-center justify-center flex-shrink-0 text-white shadow-md disabled:opacity-30 disabled:shadow-none enabled:hover:scale-105 active:scale-90 transition"
                    style={{ background: 'linear-gradient(135deg,#10b981,#0d9488)' }} aria-label={t('chat.send')}>
                    <ArrowUp className="w-4 h-4" strokeWidth={2.5} />
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
