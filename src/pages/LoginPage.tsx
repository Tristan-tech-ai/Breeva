import { useState, useRef, useEffect } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../stores/authStore';
import { Eye, EyeOff, Mail, Lock, User, ArrowLeft, KeyRound, RotateCcw } from 'lucide-react';
import logoBreeva from '../assets/logo-breeva.svg';

type AuthView = 'login' | 'signup' | 'verify-otp' | 'forgot-password' | 'reset-sent';

export default function LoginPage() {
  const {
    user, isLoading, signInWithGoogle, signInWithEmail, signUpWithEmail,
    verifyOtp, resendOtp, sendResetPasswordEmail, pendingVerification,
    error, setError,
  } = useAuthStore();
  const [view, setView] = useState<AuthView>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [resetEmail, setResetEmail] = useState('');
  const location = useLocation();
  const from = (location.state as { from?: { pathname: string } })?.from?.pathname || '/';

  // Auto-switch to verify-otp when pendingVerification exists
  useEffect(() => {
    if (pendingVerification && view === 'signup') {
      setView('verify-otp');
    }
  }, [pendingVerification, view]);

  // Redirect if already authenticated
  if (user && !isLoading) {
    return <Navigate to={from} replace />;
  }

  const handleGoogleSignIn = async () => {
    setIsSubmitting(true);
    await signInWithGoogle();
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    if (view === 'login') {
      const ok = await signInWithEmail(email, password);
      if (!ok) setIsSubmitting(false);
    } else {
      if (!fullName.trim()) {
        setError('Please enter your full name');
        setIsSubmitting(false);
        return;
      }
      const ok = await signUpWithEmail(email, password, fullName.trim());
      setIsSubmitting(false);
      if (ok) setView('verify-otp');
    }
  };

  const handleOtpChange = (index: number, value: string) => {
    if (!/^\d*$/.test(value)) return;
    const newDigits = [...otpDigits];
    newDigits[index] = value.slice(-1);
    setOtpDigits(newDigits);
    if (value && index < 5) {
      otpRefs.current[index + 1]?.focus();
    }
  };

  const handleOtpKeyDown = (index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace' && !otpDigits[index] && index > 0) {
      otpRefs.current[index - 1]?.focus();
    }
  };

  const handleOtpPaste = (e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 6);
    if (!pasted) return;
    const newDigits = [...otpDigits];
    for (let i = 0; i < 6; i++) newDigits[i] = pasted[i] || '';
    setOtpDigits(newDigits);
    const focusIdx = Math.min(pasted.length, 5);
    otpRefs.current[focusIdx]?.focus();
  };

  const handleVerifyOtp = async () => {
    const code = otpDigits.join('');
    if (code.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }
    setIsSubmitting(true);
    const ok = await verifyOtp(code);
    if (!ok) {
      setIsSubmitting(false);
      setOtpDigits(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    }
  };

  const handleResendOtp = async () => {
    setIsSubmitting(true);
    await resendOtp();
    setIsSubmitting(false);
    setOtpDigits(['', '', '', '', '', '']);
  };

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!resetEmail.trim()) {
      setError('Please enter your email');
      return;
    }
    setIsSubmitting(true);
    const ok = await sendResetPasswordEmail(resetEmail.trim());
    setIsSubmitting(false);
    if (ok) setView('reset-sent');
  };

  const switchView = (v: AuthView) => {
    setView(v);
    setError(null);
  };

  return (
    <div className="gradient-mesh-bg min-h-screen flex flex-col">
      {/* Desktop: Split layout / Mobile: Single column */}
      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Left Panel - Branding (Desktop only) */}
        <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden items-center justify-center p-12">
          {/* Decorative gradient blobs */}
          <div className="absolute inset-0">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-500/20 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent-500/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
            <div className="absolute top-1/2 left-1/2 w-72 h-72 bg-secondary-500/10 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="relative z-10 max-w-lg text-center"
          >
            {/* Logo */}
            <div className="flex items-center justify-center gap-3 mb-8">
              {logoBreeva ? (
                <img src={logoBreeva} alt="Breeva" className="h-14 w-auto" />
              ) : (
                <span className="text-5xl">🍃</span>
              )}
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white tracking-tight">
                Breeva
              </h1>
            </div>

            <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
              Transform your walks into rewards
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-400 leading-relaxed">
              Walk eco-friendly routes, earn EcoPoints, and redeem them at sustainable merchants near you.
            </p>

            {/* Stats */}
            <div className="mt-12 grid grid-cols-3 gap-6">
              {[
                { label: 'Active Walkers', value: '1,000+' },
                { label: 'CO₂ Saved', value: '2.5 tons' },
                { label: 'EcoPoints Shared', value: '500K+' },
              ].map((stat) => (
                <div key={stat.label} className="glass-card p-4">
                  <div className="text-xl font-bold text-primary-600 dark:text-primary-400">
                    {stat.value}
                  </div>
                  <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {stat.label}
                  </div>
                </div>
              ))}
            </div>
          </motion.div>
        </div>

        {/* Right Panel / Main (Login Card) */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, ease: 'easeOut' }}
            className="w-full max-w-md"
          >
            {/* Mobile Logo */}
            <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
              {logoBreeva ? (
                <img src={logoBreeva} alt="Breeva" className="h-10 w-auto" />
              ) : (
                <span className="text-4xl">🍃</span>
              )}
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">
                Breeva
              </h1>
            </div>

            {/* Glass Login Card */}
            <div className="glass-card p-8 lg:p-10">
              <AnimatePresence mode="wait">
                {/* ─── LOGIN / SIGNUP ─── */}
                {(view === 'login' || view === 'signup') && (
                  <motion.div key="auth-form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                    {/* Tab Switcher */}
                    <div className="flex rounded-xl bg-gray-100 dark:bg-gray-800/60 p-1 mb-6">
                      {(['login', 'signup'] as AuthView[]).map((v) => (
                        <button
                          key={v}
                          onClick={() => switchView(v)}
                          className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-all duration-200 ${
                            view === v
                              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                              : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                          }`}
                        >
                          {v === 'login' ? 'Sign In' : 'Sign Up'}
                        </button>
                      ))}
                    </div>

                    <div className="text-center mb-6">
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                        {view === 'login' ? 'Welcome back' : 'Create account'}
                      </h2>
                      <p className="text-gray-500 dark:text-gray-400 mt-1 text-sm">
                        {view === 'login' ? 'Sign in to continue earning rewards' : 'Start your eco-walking journey'}
                      </p>
                    </div>

                    {/* Error message */}
                    <AnimatePresence>
                      {error && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm text-center"
                        >
                          {error}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* Email/Password Form */}
                    <form onSubmit={handleEmailSubmit} className="space-y-4">
                      {/* Name field (signup only) */}
                      <AnimatePresence>
                        {view === 'signup' && (
                          <motion.div
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.2 }}
                          >
                            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                              Full Name
                            </label>
                            <div className="relative">
                              <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                              <input
                                type="text"
                                value={fullName}
                                onChange={(e) => setFullName(e.target.value)}
                                placeholder="John Doe"
                                className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition"
                                required
                              />
                            </div>
                          </motion.div>
                        )}
                      </AnimatePresence>

                      {/* Email */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                          Email
                        </label>
                        <div className="relative">
                          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                          <input
                            type="email"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="you@email.com"
                            className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition"
                            required
                          />
                        </div>
                      </div>

                      {/* Password */}
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                          Password
                        </label>
                        <div className="relative">
                          <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                          <input
                            type={showPassword ? 'text' : 'password'}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••••"
                            className="w-full pl-11 pr-12 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition"
                            required
                            minLength={6}
                          />
                          <button
                            type="button"
                            onClick={() => setShowPassword(!showPassword)}
                            className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition"
                          >
                            {showPassword ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                          </button>
                        </div>
                      </div>

                      {/* Forgot Password link (login only) */}
                      {view === 'login' && (
                        <div className="text-right">
                          <button
                            type="button"
                            onClick={() => switchView('forgot-password')}
                            className="text-sm text-primary-500 hover:text-primary-600 dark:hover:text-primary-400 font-medium transition"
                          >
                            Forgot password?
                          </button>
                        </div>
                      )}

                      {/* Submit Button */}
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-semibold shadow-lg shadow-primary-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                      >
                        {isSubmitting ? (
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-4.5 h-4.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>{view === 'login' ? 'Signing in...' : 'Sending verification...'}</span>
                          </div>
                        ) : (
                          view === 'login' ? 'Sign In' : 'Create Account'
                        )}
                      </button>
                    </form>

                    {/* Divider */}
                    <div className="my-6 flex items-center gap-3">
                      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                      <span className="text-xs text-gray-400 dark:text-gray-500 uppercase tracking-wider">or</span>
                      <div className="flex-1 h-px bg-gray-200 dark:bg-gray-700" />
                    </div>

                    {/* Google Sign-In Button */}
                    <button
                      onClick={handleGoogleSignIn}
                      disabled={isSubmitting}
                      className="glass-button w-full flex items-center justify-center gap-3 py-3 px-6 text-sm font-medium text-gray-700 dark:text-gray-200 hover:border-primary-300 dark:hover:border-primary-600 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      <svg className="w-5 h-5" viewBox="0 0 24 24">
                        <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                        <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                        <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                        <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                      </svg>
                      <span>Continue with Google</span>
                    </button>

                    <p className="mt-5 text-center text-xs text-gray-400 dark:text-gray-500 leading-relaxed">
                      Your data is encrypted and secure. We never share your information.
                    </p>
                  </motion.div>
                )}

                {/* ─── VERIFY OTP ─── */}
                {view === 'verify-otp' && (
                  <motion.div key="otp-form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                    <button
                      onClick={() => { switchView('signup'); useAuthStore.setState({ pendingVerification: null }); }}
                      className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-4 transition"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Back
                    </button>

                    <div className="text-center mb-6">
                      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900/40 dark:to-primary-800/30 flex items-center justify-center">
                        <KeyRound className="w-7 h-7 text-primary-600 dark:text-primary-400" />
                      </div>
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Verify your email</h2>
                      <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                        We sent a 6-digit code to<br />
                        <span className="font-semibold text-gray-700 dark:text-gray-300">{pendingVerification?.email}</span>
                      </p>
                    </div>

                    {/* Error message */}
                    <AnimatePresence>
                      {error && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm text-center"
                        >
                          {error}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* OTP Input */}
                    <div className="flex justify-center gap-2.5 mb-6" onPaste={handleOtpPaste}>
                      {otpDigits.map((digit, i) => (
                        <input
                          key={i}
                          ref={(el) => { otpRefs.current[i] = el; }}
                          type="text"
                          inputMode="numeric"
                          maxLength={1}
                          value={digit}
                          onChange={(e) => handleOtpChange(i, e.target.value)}
                          onKeyDown={(e) => handleOtpKeyDown(i, e)}
                          className="w-12 h-14 text-center text-xl font-bold rounded-xl border-2 border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition"
                        />
                      ))}
                    </div>

                    <button
                      onClick={handleVerifyOtp}
                      disabled={isSubmitting || otpDigits.join('').length < 6}
                      className="w-full py-3 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-semibold shadow-lg shadow-primary-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                    >
                      {isSubmitting ? (
                        <div className="flex items-center justify-center gap-2">
                          <div className="w-4.5 h-4.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                          <span>Verifying...</span>
                        </div>
                      ) : 'Verify & Create Account'}
                    </button>

                    <div className="mt-4 text-center">
                      <button
                        onClick={handleResendOtp}
                        disabled={isSubmitting}
                        className="inline-flex items-center gap-1.5 text-sm text-primary-500 hover:text-primary-600 dark:hover:text-primary-400 font-medium disabled:opacity-50 transition"
                      >
                        <RotateCcw className="w-3.5 h-3.5" />
                        Resend code
                      </button>
                    </div>
                  </motion.div>
                )}

                {/* ─── FORGOT PASSWORD ─── */}
                {view === 'forgot-password' && (
                  <motion.div key="forgot-form" initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -20 }} transition={{ duration: 0.2 }}>
                    <button
                      onClick={() => switchView('login')}
                      className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-4 transition"
                    >
                      <ArrowLeft className="w-4 h-4" />
                      Back to login
                    </button>

                    <div className="text-center mb-6">
                      <div className="w-14 h-14 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-900/40 dark:to-amber-800/30 flex items-center justify-center">
                        <Lock className="w-7 h-7 text-amber-600 dark:text-amber-400" />
                      </div>
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Reset password</h2>
                      <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                        Enter your email and we'll send you a link to reset your password.
                      </p>
                    </div>

                    {/* Error message */}
                    <AnimatePresence>
                      {error && (
                        <motion.div
                          initial={{ opacity: 0, y: -10 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -10 }}
                          className="mb-4 p-3 rounded-xl bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 text-sm text-center"
                        >
                          {error}
                        </motion.div>
                      )}
                    </AnimatePresence>

                    <form onSubmit={handleForgotPassword} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                          Email
                        </label>
                        <div className="relative">
                          <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-gray-400" />
                          <input
                            type="email"
                            value={resetEmail}
                            onChange={(e) => setResetEmail(e.target.value)}
                            placeholder="you@email.com"
                            className="w-full pl-11 pr-4 py-3 rounded-xl border border-gray-200 dark:border-gray-700 bg-white/50 dark:bg-gray-800/50 text-gray-900 dark:text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-primary-500/30 focus:border-primary-500 transition"
                            required
                          />
                        </div>
                      </div>

                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-semibold shadow-lg shadow-primary-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                      >
                        {isSubmitting ? (
                          <div className="flex items-center justify-center gap-2">
                            <div className="w-4.5 h-4.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                            <span>Sending...</span>
                          </div>
                        ) : 'Send Reset Link'}
                      </button>
                    </form>
                  </motion.div>
                )}

                {/* ─── RESET EMAIL SENT ─── */}
                {view === 'reset-sent' && (
                  <motion.div key="reset-sent" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} transition={{ duration: 0.3 }}>
                    <div className="text-center">
                      <div className="w-16 h-16 mx-auto mb-5 rounded-full bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900/40 dark:to-primary-800/30 flex items-center justify-center">
                        <Mail className="w-8 h-8 text-primary-600 dark:text-primary-400" />
                      </div>
                      <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Check your email</h2>
                      <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">
                        We sent a password reset link to
                      </p>
                      <p className="font-semibold text-gray-700 dark:text-gray-300 mb-6">{resetEmail}</p>
                      <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
                        Didn't get the email? Check your spam folder or try again.
                      </p>
                      <button
                        onClick={() => switchView('login')}
                        className="w-full py-3 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-semibold shadow-lg shadow-primary-500/25 transition-all duration-200"
                      >
                        Back to Sign In
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Terms & Privacy */}
            <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-500">
              By continuing, you agree to our{' '}
              <a href="/terms" className="text-primary-500 hover:underline">
                Terms of Service
              </a>{' '}
              and{' '}
              <a href="/privacy" className="text-primary-500 hover:underline">
                Privacy Policy
              </a>
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
