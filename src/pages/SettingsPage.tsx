import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import toast from 'react-hot-toast';
import {
  Moon, Bell, CalendarDays, Wind, User, Trash2, Smartphone, FileText, Lock,
  Globe, Ruler, Contrast, LogOut, Download, RefreshCw, RotateCcw, ShieldAlert,
  ChevronRight, Loader2, Check, X, Mail,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import BottomNavigation from '../components/layout/BottomNavigation';
import PageHeader from '../components/ui/PageHeader';
import { useAuthStore } from '../stores/authStore';
import { useSettingsStore } from '../stores/settingsStore';
import { useI18nStore } from '../stores/i18nStore';
import { supabase } from '../lib/supabase';
import { requestNotificationPermission } from '../lib/notifications';

type Tone = 'active' | 'off' | 'warn';
function Pill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const cls =
    tone === 'active'
      ? 'bg-emerald-50 dark:bg-emerald-900/20 text-emerald-600 dark:text-emerald-400'
      : tone === 'warn'
      ? 'bg-amber-50 dark:bg-amber-900/20 text-amber-600 dark:text-amber-400'
      : 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500';
  return <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap ${cls}`}>{children}</span>;
}

function Toggle({ on, onClick, disabled }: { on: boolean; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); if (!disabled) onClick(); }}
      disabled={disabled}
      role="switch"
      aria-checked={on}
      className={`relative inline-flex h-7 w-12 shrink-0 items-center rounded-full px-1 transition-colors duration-200 ${
        on ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'
      } ${disabled ? 'opacity-40 cursor-not-allowed' : ''}`}
    >
      <span
        className={`h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
          on ? 'translate-x-5' : 'translate-x-0'
        }`}
      />
    </button>
  );
}

function Segmented<T extends string>({ value, options, onChange }: {
  value: T; options: { value: T; label: string }[]; onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-xl overflow-hidden border border-gray-200 dark:border-gray-700 flex-shrink-0">
      {options.map((opt) => (
        <button
          key={opt.value}
          onClick={(e) => { e.stopPropagation(); onChange(opt.value); }}
          className={`px-3 py-1.5 text-[11px] font-semibold transition ${
            value === opt.value
              ? 'bg-primary-500 text-white'
              : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );
}

/** One settings row: icon chip + label/desc on the left, control/pill/chevron on the right. */
function Row({ icon: Icon, label, desc, danger, onClick, right }: {
  icon: LucideIcon; label: string; desc?: string; danger?: boolean;
  onClick?: () => void; right?: ReactNode;
}) {
  const clickable = !!onClick;
  return (
    <div
      onClick={onClick}
      className={`w-full flex items-center justify-between gap-3 px-4 py-3.5 text-left transition-colors ${
        clickable ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-white/5' : ''
      }`}
    >
      <div className="flex items-center gap-3 min-w-0">
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0 ${
          danger ? 'bg-red-50 dark:bg-red-900/20' : 'bg-primary-50 dark:bg-primary-900/20'
        }`}>
          <Icon className={`w-[18px] h-[18px] ${danger ? 'text-red-500' : 'text-primary-500'}`} strokeWidth={1.9} />
        </div>
        <div className="min-w-0">
          <div className={`text-sm font-semibold ${danger ? 'text-red-500' : 'text-gray-900 dark:text-white'}`}>{label}</div>
          {desc && <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 leading-snug">{desc}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2 flex-shrink-0">{right}</div>
    </div>
  );
}

function Section({ title, children, index, reduce }: {
  title: string; children: ReactNode; index: number; reduce: boolean;
}) {
  return (
    <motion.div
      initial={reduce ? false : { opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: reduce ? 0 : index * 0.04 }}
    >
      <h3 className="text-xs font-bold text-gray-500 dark:text-gray-400 uppercase tracking-wider mb-2 px-1">{title}</h3>
      <div className="glass-card overflow-hidden divide-y divide-gray-100 dark:divide-gray-800/70">{children}</div>
    </motion.div>
  );
}

type ModalKind = null | 'deleteData' | 'reset' | 'clearCache' | 'deleteAccount';

export default function SettingsPage() {
  const navigate = useNavigate();
  const { user, profile, signOut, fetchProfile } = useAuthStore();
  const { t } = useI18nStore();
  const s = useSettingsStore();
  const setSetting = useSettingsStore((st) => st.set);
  const reduce = useReducedMotion() ?? false;

  const [perm, setPerm] = useState<NotificationPermission>(
    typeof Notification !== 'undefined' ? Notification.permission : 'denied',
  );
  const [modal, setModal] = useState<ModalKind>(null);
  const [busy, setBusy] = useState(false);

  // Delete-account OTP flow state
  const [otpSent, setOtpSent] = useState(false);
  const [otpInput, setOtpInput] = useState('');
  const [otpExpected, setOtpExpected] = useState('');
  const [otpExpires, setOtpExpires] = useState(0);
  const [otpError, setOtpError] = useState('');
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);

  const closeModalForce = () => {
    setModal(null);
    setOtpSent(false); setOtpInput(''); setOtpExpected(''); setOtpError(''); setScheduledFor(null);
  };
  const closeModal = () => { if (!busy) closeModalForce(); };

  // ── Toggles ──────────────────────────────────────────────────────
  const togglePush = async () => {
    if (!s.push_notifications) {
      const p = await requestNotificationPermission();
      setPerm(p);
      if (p !== 'granted') { toast.error(t('settings.push_denied')); return; }
    }
    setSetting('push_notifications', !s.push_notifications);
  };

  // ── Account actions ──────────────────────────────────────────────
  const handleExport = async () => {
    setBusy(true);
    try {
      const { data, error } = await supabase.rpc('export_my_data');
      if (error) throw error;
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `breeva-data-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a); a.click(); a.remove();
      URL.revokeObjectURL(url);
      toast.success(t('account.export_ok'));
    } catch {
      toast.error(t('account.export_fail'));
    } finally {
      setBusy(false);
    }
  };

  const handleSignOut = async () => {
    await signOut();
    navigate('/login');
  };

  const handleReset = async () => {
    setBusy(true);
    try {
      useSettingsStore.getState().resetToDefaults();
      toast.success(t('account.reset_ok'));
      closeModalForce();
    } finally {
      setBusy(false);
    }
  };

  const handleClearCache = async () => {
    setBusy(true);
    try {
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
      try {
        const reg = await navigator.serviceWorker?.getRegistration();
        await reg?.update();
      } catch { /* ignore */ }
      toast.success(t('account.clear_cache_ok'));
      setTimeout(() => window.location.reload(), 600);
    } finally {
      setBusy(false);
    }
  };

  const handleDeleteData = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.rpc('delete_my_data');
      if (error) throw error;
      await fetchProfile();
      toast.success(t('account.delete_data_ok'));
      closeModalForce();
    } catch {
      toast.error(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  // ── Delete account: client OTP (mirrors signup) → schedule 30-day grace ──
  const sendDeleteOtp = async () => {
    if (!user?.email) { toast.error(t('common.error')); return; }
    setBusy(true); setOtpError('');
    try {
      const code = String(Math.floor(100000 + Math.random() * 900000));
      const res = await fetch('/api/auth/email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'verification', email: user.email, name: profile?.full_name || 'there', otp: code }),
      });
      if (!res.ok) throw new Error('send failed');
      setOtpExpected(code);
      setOtpExpires(Date.now() + 15 * 60 * 1000);
      setOtpSent(true);
    } catch {
      toast.error(t('account.code_fail'));
    } finally {
      setBusy(false);
    }
  };

  const confirmDeleteAccount = async () => {
    if (Date.now() > otpExpires) { setOtpError(t('account.code_expired')); return; }
    if (otpInput.trim() !== otpExpected) { setOtpError(t('account.code_invalid')); return; }
    setBusy(true); setOtpError('');
    try {
      const { data, error } = await supabase.rpc('request_account_deletion');
      if (error) throw error;
      setScheduledFor(typeof data === 'string' ? data : null);
    } catch {
      toast.error(t('common.error'));
    } finally {
      setBusy(false);
    }
  };

  // ── Derived status ───────────────────────────────────────────────
  const pushPill: { tone: Tone; label: string } = !s.push_notifications
    ? { tone: 'off', label: t('status.off') }
    : perm !== 'granted'
    ? { tone: 'warn', label: t('status.needs_permission') }
    : { tone: 'active', label: t('status.active') };

  const fmtDate = (iso: string) => {
    try { return new Date(iso).toLocaleDateString(s.language === 'id' ? 'id-ID' : 'en-US', { day: 'numeric', month: 'long', year: 'numeric' }); }
    catch { return iso; }
  };

  return (
    <div className="gradient-mesh-bg min-h-screen pb-24">
      <PageHeader title={t('settings.title')} onBack={() => navigate(-1)} />

      <div className="max-w-2xl mx-auto px-4 pt-4 pb-12 space-y-5">
        {/* Grace banner */}
        {profile?.deletion_scheduled_at && (
          <motion.div
            initial={reduce ? false : { opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-900/20 p-4 flex items-start gap-3"
          >
            <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-red-700 dark:text-red-300">{t('account.scheduled_title')}</p>
              <p className="text-xs text-red-600/80 dark:text-red-400/80 mt-0.5">
                {t('account.scheduled_until', { date: fmtDate(profile.deletion_scheduled_at) })}
              </p>
              <button
                onClick={async () => {
                  const { error } = await supabase.rpc('cancel_account_deletion');
                  if (!error) { await fetchProfile(); toast.success(t('account.cancel_ok')); }
                  else toast.error(t('common.error'));
                }}
                className="mt-2 text-xs font-bold text-white bg-red-500 hover:bg-red-600 px-3 py-1.5 rounded-lg transition-colors"
              >
                {t('account.cancel_deletion')}
              </button>
            </div>
          </motion.div>
        )}

        {/* Appearance */}
        <Section title={t('settings.appearance')} index={0} reduce={reduce}>
          <Row icon={Moon} label={t('settings.dark_mode')} desc={t('settings.dark_mode_desc')}
            onClick={() => setSetting('dark_mode', !s.dark_mode)}
            right={<Toggle on={s.dark_mode} onClick={() => setSetting('dark_mode', !s.dark_mode)} />} />
          <Row icon={Contrast} label={t('settings.high_contrast')} desc={t('settings.high_contrast_desc')}
            onClick={() => setSetting('high_contrast', !s.high_contrast)}
            right={<Toggle on={s.high_contrast} onClick={() => setSetting('high_contrast', !s.high_contrast)} />} />
        </Section>

        {/* Language & Units */}
        <Section title={t('settings.lang_units')} index={1} reduce={reduce}>
          <Row icon={Globe} label={t('settings.language')} desc={t('settings.language_desc')}
            right={<Segmented value={s.language} onChange={(v) => setSetting('language', v)}
              options={[{ value: 'id', label: 'ID' }, { value: 'en', label: 'EN' }]} />} />
          <Row icon={Ruler} label={t('settings.distance_unit')} desc={t('settings.distance_unit_desc')}
            right={<Segmented value={s.distance_unit} onChange={(v) => setSetting('distance_unit', v)}
              options={[{ value: 'km', label: t('common.km') }, { value: 'miles', label: t('common.miles') }]} />} />
        </Section>

        {/* Notifications */}
        <Section title={t('settings.notifications')} index={2} reduce={reduce}>
          <Row icon={Bell} label={t('settings.push')} desc={t('settings.push_desc')}
            onClick={togglePush}
            right={<><Pill tone={pushPill.tone}>{pushPill.label}</Pill><Toggle on={s.push_notifications} onClick={togglePush} /></>} />
          <Row icon={CalendarDays} label={t('settings.quest_reminders')} desc={t('settings.quest_reminders_desc')}
            onClick={s.push_notifications ? () => setSetting('quest_reminders', !s.quest_reminders) : undefined}
            right={<><Pill tone={s.push_notifications ? (s.quest_reminders ? 'active' : 'off') : 'warn'}>
              {s.push_notifications ? (s.quest_reminders ? t('status.active') : t('status.off')) : t('status.requires_push')}
            </Pill><Toggle on={s.quest_reminders} disabled={!s.push_notifications} onClick={() => setSetting('quest_reminders', !s.quest_reminders)} /></>} />
        </Section>

        {/* Privacy */}
        <Section title={t('settings.privacy')} index={3} reduce={reduce}>
          <Row icon={Wind} label={t('settings.vayu_trace')} desc={t('settings.vayu_trace_desc')}
            onClick={() => setSetting('anonymous_data', !s.anonymous_data)}
            right={<Toggle on={s.anonymous_data} onClick={() => setSetting('anonymous_data', !s.anonymous_data)} />} />
          <Row icon={User} label={t('settings.profile_visible')} desc={t('settings.profile_visible_desc')}
            onClick={() => setSetting('profile_visible', !s.profile_visible)}
            right={<><Pill tone={s.profile_visible ? 'active' : 'off'}>{s.profile_visible ? t('status.visible') : t('status.hidden')}</Pill>
              <Toggle on={s.profile_visible} onClick={() => setSetting('profile_visible', !s.profile_visible)} /></>} />
          <Row icon={Lock} label={t('settings.privacy_policy')} onClick={() => navigate('/privacy')}
            right={<ChevronRight className="w-4 h-4 text-gray-400" />} />
        </Section>

        {/* Account */}
        <Section title={t('settings.account')} index={4} reduce={reduce}>
          <Row icon={User} label={t('account.edit_profile')} desc={t('account.edit_profile_desc')}
            onClick={() => navigate('/profile/edit')} right={<ChevronRight className="w-4 h-4 text-gray-400" />} />
          <Row icon={Download} label={t('account.export')} desc={t('account.export_desc')}
            onClick={busy ? undefined : handleExport}
            right={busy ? <Loader2 className="w-4 h-4 text-gray-400 animate-spin" /> : <ChevronRight className="w-4 h-4 text-gray-400" />} />
          <Row icon={RefreshCw} label={t('account.clear_cache')} desc={t('account.clear_cache_desc')}
            onClick={() => setModal('clearCache')} right={<ChevronRight className="w-4 h-4 text-gray-400" />} />
          <Row icon={RotateCcw} label={t('account.reset')} desc={t('account.reset_desc')}
            onClick={() => setModal('reset')} right={<ChevronRight className="w-4 h-4 text-gray-400" />} />
          <Row icon={LogOut} label={t('account.sign_out')} onClick={handleSignOut}
            right={<ChevronRight className="w-4 h-4 text-gray-400" />} />
          <Row icon={Trash2} label={t('account.delete_data')} desc={t('account.delete_data_desc')} danger
            onClick={() => setModal('deleteData')} right={<ChevronRight className="w-4 h-4 text-red-300" />} />
          <Row icon={ShieldAlert} label={t('account.delete_account')} desc={t('account.delete_account_desc')} danger
            onClick={() => setModal('deleteAccount')} right={<ChevronRight className="w-4 h-4 text-red-300" />} />
        </Section>

        {/* About */}
        <Section title={t('settings.about')} index={5} reduce={reduce}>
          <Row icon={Smartphone} label={t('settings.version')} right={<span className="text-xs text-gray-400">v0.1.0</span>} />
          <Row icon={FileText} label={t('settings.terms')} onClick={() => navigate('/terms')}
            right={<ChevronRight className="w-4 h-4 text-gray-400" />} />
        </Section>
      </div>

      {/* ── Modals ── */}
      <AnimatePresence>
        {modal && (
          <motion.div
            className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
          >
            <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={closeModal} />
            <motion.div
              initial={reduce ? false : { y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={reduce ? { opacity: 0 } : { y: 40, opacity: 0 }}
              className="relative w-full sm:max-w-md bg-white dark:bg-gray-900 rounded-t-3xl sm:rounded-3xl p-6 shadow-2xl safe-area-bottom"
            >
              {/* Simple confirms */}
              {modal === 'clearCache' && (
                <Confirm icon={RefreshCw} title={t('account.clear_cache_title')} body={t('account.clear_cache_explain')}
                  cancel={t('common.cancel')} confirm={t('account.clear_cache')} busy={busy}
                  onCancel={closeModal} onConfirm={handleClearCache} />
              )}
              {modal === 'reset' && (
                <Confirm icon={RotateCcw} title={t('account.reset_title')} body={t('account.reset_explain')}
                  cancel={t('common.cancel')} confirm={t('account.reset')} busy={busy}
                  onCancel={closeModal} onConfirm={handleReset} />
              )}
              {modal === 'deleteData' && (
                <Confirm icon={Trash2} danger title={t('account.delete_data_title')} body={t('account.delete_data_explain')}
                  cancel={t('common.cancel')} confirm={t('account.delete_data')} busy={busy}
                  onCancel={closeModal} onConfirm={handleDeleteData} />
              )}

              {/* Delete account — OTP + grace */}
              {modal === 'deleteAccount' && (
                <div>
                  <div className="flex items-center gap-3 mb-3">
                    <div className="w-11 h-11 rounded-2xl bg-red-50 dark:bg-red-900/20 flex items-center justify-center">
                      <ShieldAlert className="w-5 h-5 text-red-500" />
                    </div>
                    <h3 className="text-lg font-bold text-gray-900 dark:text-white">{t('account.delete_account')}</h3>
                  </div>

                  {scheduledFor ? (
                    <div className="text-center py-2">
                      <div className="w-14 h-14 rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center mx-auto mb-3">
                        <Check className="w-7 h-7 text-emerald-500" />
                      </div>
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{t('account.scheduled_title')}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 mb-5">
                        {t('account.scheduled_until', { date: fmtDate(scheduledFor) })}
                      </p>
                      <button onClick={async () => { closeModalForce(); await handleSignOut(); }}
                        className="w-full py-3 rounded-xl bg-gray-900 dark:bg-white text-white dark:text-gray-900 font-bold text-sm">
                        {t('account.sign_out')}
                      </button>
                    </div>
                  ) : !otpSent ? (
                    <>
                      <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-4">{t('account.delete_account_explain')}</p>
                      <div className="flex gap-2">
                        <button onClick={closeModal} disabled={busy}
                          className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-semibold text-sm">
                          {t('common.cancel')}
                        </button>
                        <button onClick={sendDeleteOtp} disabled={busy}
                          className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
                          {t('account.send_code')}
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-1">
                        {t('account.enter_code', { email: user?.email || '' })}
                      </p>
                      <input
                        value={otpInput}
                        onChange={(e) => { setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6)); setOtpError(''); }}
                        inputMode="numeric" placeholder="000000" maxLength={6}
                        className="w-full text-center text-2xl font-bold tracking-[0.5em] py-3 my-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-red-400"
                      />
                      {otpError && <p className="text-xs text-red-500 mb-2 flex items-center gap-1"><X className="w-3 h-3" />{otpError}</p>}
                      <div className="flex gap-2 mt-1">
                        <button onClick={closeModal} disabled={busy}
                          className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-semibold text-sm">
                          {t('common.cancel')}
                        </button>
                        <button onClick={confirmDeleteAccount} disabled={busy || otpInput.length < 6}
                          className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60">
                          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                          {t('account.confirm_delete')}
                        </button>
                      </div>
                      <button onClick={sendDeleteOtp} disabled={busy}
                        className="w-full mt-2 text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                        {t('account.resend_code')}
                      </button>
                    </>
                  )}
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <BottomNavigation />
    </div>
  );
}

function Confirm({ icon: Icon, title, body, cancel, confirm, onCancel, onConfirm, busy, danger }: {
  icon: LucideIcon; title: string; body: string; cancel: string; confirm: string;
  onCancel: () => void; onConfirm: () => void; busy: boolean; danger?: boolean;
}) {
  return (
    <div>
      <div className="flex items-center gap-3 mb-3">
        <div className={`w-11 h-11 rounded-2xl flex items-center justify-center ${danger ? 'bg-red-50 dark:bg-red-900/20' : 'bg-primary-50 dark:bg-primary-900/20'}`}>
          <Icon className={`w-5 h-5 ${danger ? 'text-red-500' : 'text-primary-500'}`} />
        </div>
        <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
      </div>
      <p className="text-sm text-gray-500 dark:text-gray-400 leading-relaxed mb-5">{body}</p>
      <div className="flex gap-2">
        <button onClick={onCancel} disabled={busy}
          className="flex-1 py-3 rounded-xl bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-200 font-semibold text-sm">{cancel}</button>
        <button onClick={onConfirm} disabled={busy}
          className={`flex-1 py-3 rounded-xl text-white font-bold text-sm flex items-center justify-center gap-2 disabled:opacity-60 ${danger ? 'bg-red-500 hover:bg-red-600' : 'bg-primary-500 hover:bg-primary-600'}`}>
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null}{confirm}
        </button>
      </div>
    </div>
  );
}
