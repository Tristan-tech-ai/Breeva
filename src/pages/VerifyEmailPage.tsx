import { useState, useRef, useEffect } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useAuthStore } from '../stores/authStore';
import { KeyRound, ArrowLeft, RotateCcw, CheckCircle, Clock } from 'lucide-react';
import logoBreeva from '../assets/logo-breeva.svg';

export default function VerifyEmailPage() {
  const { pendingVerification, verifyOtp, resendOtp, error, setError, isLoading } = useAuthStore();
  const navigate = useNavigate();
  const [otpDigits, setOtpDigits] = useState(['', '', '', '', '', '']);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [verified, setVerified] = useState(false);

  // Resend cooldown timer
  useEffect(() => {
    if (resendCooldown <= 0) return;
    const timer = setTimeout(() => setResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [resendCooldown]);

  // Auto-focus first input on mount
  useEffect(() => {
    otpRefs.current[0]?.focus();
  }, []);

  // No pending verification → go back to login
  if (!pendingVerification && !verified) {
    return <Navigate to="/login" replace />;
  }

  // Check if OTP expired
  const isExpired = pendingVerification ? Date.now() > pendingVerification.expiresAt : false;
  const timeLeft = pendingVerification
    ? Math.max(0, Math.floor((pendingVerification.expiresAt - Date.now()) / 1000))
    : 0;
  const minutesLeft = Math.floor(timeLeft / 60);
  const secondsLeft = timeLeft % 60;

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

  const handleVerify = async () => {
    const code = otpDigits.join('');
    if (code.length !== 6) {
      setError('Please enter the 6-digit code');
      return;
    }
    setIsSubmitting(true);
    const ok = await verifyOtp(code);
    setIsSubmitting(false);
    if (ok) {
      setVerified(true);
      // Brief success animation then redirect
      setTimeout(() => navigate('/', { replace: true }), 1500);
    } else {
      setOtpDigits(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    }
  };

  const handleResend = async () => {
    if (resendCooldown > 0) return;
    setIsSubmitting(true);
    const ok = await resendOtp();
    setIsSubmitting(false);
    if (ok) {
      setResendCooldown(60);
      setOtpDigits(['', '', '', '', '', '']);
      otpRefs.current[0]?.focus();
    }
  };

  const handleBack = () => {
    useAuthStore.setState({ pendingVerification: null, error: null });
    navigate('/login', { replace: true });
  };

  // Success state
  if (verified) {
    return (
      <div className="gradient-mesh-bg min-h-screen flex items-center justify-center p-6">
        <motion.div
          initial={{ opacity: 0, scale: 0.9 }}
          animate={{ opacity: 1, scale: 1 }}
          className="glass-card p-10 max-w-md w-full text-center"
        >
          <motion.div
            initial={{ scale: 0 }}
            animate={{ scale: 1 }}
            transition={{ type: 'spring', delay: 0.1 }}
            className="w-20 h-20 mx-auto mb-6 rounded-full bg-gradient-to-br from-emerald-100 to-emerald-200 dark:from-emerald-900/40 dark:to-emerald-800/30 flex items-center justify-center"
          >
            <CheckCircle className="w-10 h-10 text-emerald-500" />
          </motion.div>
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">Account Created!</h2>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            Welcome to Breeva! Redirecting you now...
          </p>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="gradient-mesh-bg min-h-screen flex flex-col">
      <div className="flex flex-1 flex-col lg:flex-row">
        {/* Left Panel - Branding (Desktop only) */}
        <div className="hidden lg:flex lg:w-1/2 relative overflow-hidden items-center justify-center p-12">
          <div className="absolute inset-0">
            <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-primary-500/20 rounded-full blur-3xl animate-pulse" />
            <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-accent-500/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '1s' }} />
          </div>

          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="relative z-10 max-w-lg text-center"
          >
            <div className="flex items-center justify-center gap-3 mb-8">
              {logoBreeva ? (
                <img src={logoBreeva} alt="Breeva" className="h-14 w-auto" />
              ) : (
                <span className="text-5xl">🍃</span>
              )}
              <h1 className="text-4xl font-bold text-gray-900 dark:text-white tracking-tight">Breeva</h1>
            </div>
            <h2 className="text-2xl font-semibold text-gray-800 dark:text-gray-200 mb-4">
              Almost there!
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-400 leading-relaxed">
              We just need to verify your email to keep your account secure.
            </p>
          </motion.div>
        </div>

        {/* Right Panel */}
        <div className="flex-1 flex items-center justify-center p-6 lg:p-12">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5 }}
            className="w-full max-w-md"
          >
            {/* Mobile Logo */}
            <div className="lg:hidden flex items-center justify-center gap-2 mb-8">
              {logoBreeva ? (
                <img src={logoBreeva} alt="Breeva" className="h-10 w-auto" />
              ) : (
                <span className="text-4xl">🍃</span>
              )}
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white tracking-tight">Breeva</h1>
            </div>

            {/* Verification Card */}
            <div className="glass-card p-8 lg:p-10">
              {/* Back Button */}
              <button
                onClick={handleBack}
                className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 mb-6 transition"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to Sign Up
              </button>

              {/* Header */}
              <div className="text-center mb-6">
                <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-primary-100 to-primary-200 dark:from-primary-900/40 dark:to-primary-800/30 flex items-center justify-center">
                  <KeyRound className="w-8 h-8 text-primary-600 dark:text-primary-400" />
                </div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Verify your email</h2>
                <p className="text-gray-500 dark:text-gray-400 mt-2 text-sm">
                  We sent a 6-digit code to
                </p>
                <p className="font-semibold text-gray-700 dark:text-gray-300 mt-1">
                  {pendingVerification?.email}
                </p>
              </div>

              {/* Timer */}
              {!isExpired && (
                <div className="flex items-center justify-center gap-1.5 text-xs text-gray-400 dark:text-gray-500 mb-4">
                  <Clock className="w-3.5 h-3.5" />
                  <span>
                    Code expires in {minutesLeft}:{secondsLeft.toString().padStart(2, '0')}
                  </span>
                </div>
              )}

              {/* Expired warning */}
              {isExpired && (
                <div className="mb-4 p-3 rounded-xl bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-amber-600 dark:text-amber-400 text-sm text-center">
                  Code expired. Please resend a new code.
                </div>
              )}

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

              {/* Verify Button */}
              <button
                onClick={handleVerify}
                disabled={isSubmitting || isLoading || otpDigits.join('').length < 6 || isExpired}
                className="w-full py-3 rounded-xl bg-gradient-to-r from-primary-500 to-primary-600 hover:from-primary-600 hover:to-primary-700 text-white font-semibold shadow-lg shadow-primary-500/25 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {isSubmitting || isLoading ? (
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-4.5 h-4.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    <span>Verifying...</span>
                  </div>
                ) : 'Verify & Create Account'}
              </button>

              {/* Resend */}
              <div className="mt-5 text-center space-y-3">
                <button
                  onClick={handleResend}
                  disabled={isSubmitting || isLoading || resendCooldown > 0}
                  className="inline-flex items-center gap-1.5 text-sm text-primary-500 hover:text-primary-600 dark:hover:text-primary-400 font-medium disabled:opacity-50 transition"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  {resendCooldown > 0 ? `Resend in ${resendCooldown}s` : 'Resend code'}
                </button>

                <p className="text-xs text-gray-400 dark:text-gray-500">
                  Didn't receive the email? Check your spam folder.
                </p>
              </div>
            </div>

            {/* Security note */}
            <p className="mt-6 text-center text-xs text-gray-400 dark:text-gray-500">
              Your verification code expires in 15 minutes for security.
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
}
