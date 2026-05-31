import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Footprints, MapPin, Smartphone, Gift, CheckCircle2, Navigation2, Activity } from 'lucide-react';
import { useAuthStore } from '../stores/authStore';
import { supabase } from '../lib/supabase';
import logoBreeva from '../assets/logo-breeva.svg';

type OnboardingStep = 'welcome' | 'location' | 'motion' | 'first-walk';

const steps: OnboardingStep[] = ['welcome', 'location', 'motion', 'first-walk'];

const isIOS = () => {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as unknown as { MSStream: unknown }).MSStream;
};

export default function OnboardingPage() {
  const navigate = useNavigate();
  const { completeOnboarding } = useAuthStore();
  const [currentStep, setCurrentStep] = useState<OnboardingStep>('welcome');
  const [, setLocationGranted] = useState(false);
  const [, setMotionGranted] = useState(false);

  const showMotionStep = isIOS();
  const activeSteps = showMotionStep ? steps : steps.filter(s => s !== 'motion');
  const activeIndex = activeSteps.indexOf(currentStep);

  const goNext = () => {
    const nextIdx = activeSteps.indexOf(currentStep) + 1;
    if (nextIdx < activeSteps.length) {
      setCurrentStep(activeSteps[nextIdx]);
    }
  };

  const handleFinish = async () => {
    // Award onboarding bonus (100 EcoPoints, prevent double-award)
    const user = useAuthStore.getState().user;
    if (user) {
      try {
        // Server-authoritative, once-ever (idempotent in claim_reward).
        const { data } = await supabase.rpc('claim_reward', {
          p_user_id: user.id,
          p_type: 'onboarding_bonus',
        });
        if (data && data > 0) useAuthStore.getState().fetchProfile();
      } catch (err) {
        console.error('Onboarding bonus error:', err);
      }
    }

    completeOnboarding();
    navigate('/home', { replace: true });
  };

  const handleEnableLocation = async () => {
    try {
      const permission = await navigator.permissions.query({ name: 'geolocation' });
      if (permission.state === 'granted') {
        setLocationGranted(true);
        goNext();
        return;
      }

      navigator.geolocation.getCurrentPosition(
        () => {
          setLocationGranted(true);
          goNext();
        },
        () => {
          // Permission denied, still move forward
          goNext();
        },
        { enableHighAccuracy: true }
      );
    } catch {
      // Fallback: try direct geolocation request
      navigator.geolocation.getCurrentPosition(
        () => {
          setLocationGranted(true);
          goNext();
        },
        () => goNext()
      );
    }
  };

  const handleRequestMotion = async () => {
    try {
      // iOS 13+ requires explicit permission
      if (typeof (DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission === 'function') {
        const result = await (DeviceMotionEvent as unknown as { requestPermission: () => Promise<string> }).requestPermission();
        setMotionGranted(result === 'granted');
      } else {
        setMotionGranted(true);
      }
    } catch {
      // Permission denied
    }
    goNext();
  };

  const pageVariants = {
    enter: { opacity: 0, x: 50 },
    center: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -50 },
  };

  return (
    <div className="gradient-mesh-bg min-h-screen flex flex-col">
      {/* Skip Button */}
      <div className="flex justify-end p-4">
        <button
          onClick={handleFinish}
          className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300 dark:text-gray-600 transition-colors"
        >
          Skip
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center px-6">
        <AnimatePresence mode="wait">
          {/* Step 1: Welcome */}
          {currentStep === 'welcome' && (
            <motion.div
              key="welcome"
              variants={pageVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="w-full max-w-md text-center"
            >
              <div className="mb-10 mt-8">
                <motion.div 
                  className="w-36 h-36 mx-auto rounded-full bg-gradient-to-tr from-primary-400 to-primary-600 shadow-2xl shadow-primary-500/40 flex items-center justify-center relative"
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
                >
                  <div className="absolute inset-2 border border-white/20 rounded-full" />
                  <Footprints className="w-16 h-16 text-white" />
                </motion.div>
              </div>

              <div className="glass-card p-10 border border-white/40 dark:border-gray-800/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)]">
                {logoBreeva ? (
                  <img src={logoBreeva} alt="Breeva" className="h-10 w-auto mx-auto mb-4" />
                ) : (
                  <div className="w-12 h-12 bg-primary-100 dark:bg-primary-900/30 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Footprints className="w-6 h-6 text-primary-600 dark:text-primary-400" />
                  </div>
                )}
                <h1 className="text-2xl font-black text-gray-900 dark:text-white mb-3 tracking-tight">
                  Welcome to Breeva
                </h1>
                <p className="text-gray-500 dark:text-gray-400 text-[15px] leading-relaxed mb-10">
                  Earn real rewards for choosing healthier, eco-friendly routes. Walk more, earn EcoPoints, and redeem them at sustainable merchants.
                </p>

                <button
                  onClick={goNext}
                  className="w-full py-4 rounded-xl bg-gray-900 dark:bg-primary-600 text-white font-bold text-[15px] shadow-xl hover:shadow-2xl hover:-translate-y-0.5 active:translate-y-0 transition-all duration-200"
                >
                  Get Started
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 2: Location Permission */}
          {currentStep === 'location' && (
            <motion.div
              key="location"
              variants={pageVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="w-full max-w-md text-center"
            >
              {/* Animated Location Icon */}
              <div className="mb-10 mt-8 relative">
                <div className="w-36 h-36 mx-auto rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center shadow-lg shadow-blue-500/10">
                  <motion.div
                    animate={{ y: [0, -8, 0] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                    className="relative z-10"
                  >
                    <MapPin className="w-16 h-16 text-blue-500 drop-shadow-md" fill="currentColor" />
                  </motion.div>
                </div>
                {/* Pulse rings */}
                <motion.div
                  animate={{ scale: [1, 1.6], opacity: [0.3, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeOut" }}
                  className="absolute inset-0 mx-auto w-36 h-36 rounded-full border-2 border-blue-400"
                  style={{ top: 0 }}
                />
                <motion.div
                  animate={{ scale: [1, 1.4], opacity: [0.3, 0] }}
                  transition={{ duration: 2, repeat: Infinity, delay: 1, ease: "easeOut" }}
                  className="absolute inset-0 mx-auto w-36 h-36 rounded-full border-2 border-blue-400"
                  style={{ top: 0 }}
                />
              </div>

              <div className="glass-card p-10 border border-white/40 dark:border-gray-800/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)]">
                <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-2 tracking-tight">
                  Enable Location
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-[15px] mb-8 leading-relaxed">
                  We use your location to map eco-friendly routes and track your rewards.
                </p>

                {/* Benefits Checklist */}
                <div className="text-left space-y-4 mb-10">
                  {[
                    'Find eco-merchants near you',
                    'Track your walking distance',
                    'Show real-time air quality',
                    'Calculate earned EcoPoints',
                  ].map((benefit) => (
                    <div key={benefit} className="flex items-center gap-3.5">
                      <div className="flex items-center justify-center flex-shrink-0">
                        <CheckCircle2 className="w-5 h-5 text-blue-500" />
                      </div>
                      <span className="text-[15px] text-gray-700 dark:text-gray-300 font-medium">{benefit}</span>
                    </div>
                  ))}
                </div>

                <div className="space-y-3">
                  <button
                    onClick={handleEnableLocation}
                    className="w-full py-4 rounded-xl bg-blue-500 hover:bg-blue-600 text-white font-bold text-[15px] shadow-xl hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-200"
                  >
                    Enable Location
                  </button>
                  <button
                    onClick={goNext}
                    className="w-full py-3.5 text-sm font-semibold text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  >
                    Skip for now
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 3: Motion Permission (iOS only) */}
          {currentStep === 'motion' && (
            <motion.div
              key="motion"
              variants={pageVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="w-full max-w-md text-center"
            >
              <div className="mb-10 mt-8 relative">
                <div className="w-36 h-36 mx-auto rounded-full bg-violet-50 dark:bg-violet-900/20 flex items-center justify-center shadow-lg shadow-violet-500/10">
                  <motion.div
                    animate={{ rotate: [0, -10, 10, -10, 0] }}
                    transition={{ duration: 2.5, repeat: Infinity, ease: 'easeInOut' }}
                    className="relative z-10"
                  >
                    <Smartphone className="w-16 h-16 text-violet-500 drop-shadow-md" />
                  </motion.div>
                </div>
              </div>

              <div className="glass-card p-10 border border-white/40 dark:border-gray-800/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)]">
                <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-2 tracking-tight">
                  Motion Tracking
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-[15px] mb-8 leading-relaxed">
                  Allow motion access to accurately verify your steps and earn full rewards.
                </p>

                <div className="mb-8 p-4 rounded-xl bg-orange-50 dark:bg-orange-950/30 border border-orange-100 dark:border-orange-900/40 flex gap-3 text-left">
                  <Activity className="w-5 h-5 text-orange-500 flex-shrink-0 mt-0.5" />
                  <p className="text-[13px] text-orange-800 dark:text-orange-400 font-medium leading-relaxed">
                    Without motion access, your walks may not be verified fully, yielding reduced rewards (50% EcoPoints).
                  </p>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={handleRequestMotion}
                    className="w-full py-4 rounded-xl bg-violet-500 hover:bg-violet-600 text-white font-bold text-[15px] shadow-xl hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-200"
                  >
                    Enable Motion
                  </button>
                  <button
                    onClick={goNext}
                    className="w-full py-3.5 text-sm font-semibold text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  >
                    Skip for now
                  </button>
                </div>
              </div>
            </motion.div>
          )}

          {/* Step 4: First Walk Challenge */}
          {currentStep === 'first-walk' && (
            <motion.div
              key="first-walk"
              variants={pageVariants}
              initial="enter"
              animate="center"
              exit="exit"
              transition={{ duration: 0.3, ease: 'easeInOut' }}
              className="w-full max-w-md text-center"
            >
              <div className="mb-10 mt-8 relative">
                <div className="w-36 h-36 mx-auto rounded-full bg-emerald-50 dark:bg-emerald-900/20 flex items-center justify-center shadow-lg shadow-emerald-500/10">
                  <motion.div
                    animate={{ rotate: [0, -10, 10, -10, 0] }}
                    transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
                    className="relative z-10"
                  >
                    <Gift className="w-16 h-16 text-emerald-500 drop-shadow-md" />
                  </motion.div>
                </div>
              </div>

              <div className="glass-card p-10 border border-white/40 dark:border-gray-800/60 shadow-[0_8px_30px_rgb(0,0,0,0.04)] dark:shadow-[0_8px_30px_rgb(0,0,0,0.2)]">
                <h2 className="text-2xl font-black text-gray-900 dark:text-white mb-2 tracking-tight">
                  Welcome Bonus!
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-[15px] mb-8 leading-relaxed">
                  Start your first eco-walk right now and unlock a special welcome bonus!
                </p>

                {/* Bonus Display */}
                <div className="p-6 mb-10 rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-600 shadow-xl shadow-emerald-500/20 text-white relative overflow-hidden">
                  {/* Background decoration */}
                  <div className="absolute -top-10 -right-10 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
                  
                  <div className="relative z-10">
                    <p className="text-[13px] font-bold text-emerald-100 uppercase tracking-widest mb-1 shadow-sm">Welcome Reward</p>
                    <div className="text-4xl font-black mb-1 drop-shadow-md">+100 EP</div>
                    <p className="text-[13px] text-emerald-100 font-medium">On your first completed walk</p>
                  </div>
                </div>

                <div className="space-y-3">
                  <button
                    onClick={handleFinish}
                    className="w-full py-4 rounded-xl bg-gray-900 dark:bg-primary-600 text-white font-bold text-[15px] shadow-xl hover:shadow-2xl hover:-translate-y-0.5 transition-all duration-200 flex items-center justify-center gap-2"
                  >
                    <Navigation2 className="w-5 h-5" />
                    Start My First Walk
                  </button>
                  <button
                    onClick={handleFinish}
                    className="w-full py-3.5 text-sm font-semibold text-gray-400 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
                  >
                    I'll do it later
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Step Indicator */}
      <div className="flex justify-center gap-2 pb-8">
        {activeSteps.map((step, idx) => (
          <div
            key={step}
            className={`w-2 h-2 rounded-full transition-all duration-300 ${
              idx === activeIndex
                ? 'w-6 bg-primary-500'
                : idx < activeIndex
                ? 'bg-primary-300'
                : 'bg-gray-300 dark:bg-gray-600'
            }`}
          />
        ))}
      </div>
    </div>
  );
}
