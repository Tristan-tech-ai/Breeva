import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
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
        const { data: existing } = await supabase
          .from('points_transactions')
          .select('id')
          .eq('user_id', user.id)
          .eq('transaction_type', 'onboarding_bonus')
          .maybeSingle();

        if (!existing) {
          await supabase.rpc('add_ecopoints', {
            p_user_id: user.id,
            p_amount: 100,
            p_type: 'onboarding_bonus',
            p_description: 'Welcome bonus for completing onboarding',
          });
          useAuthStore.getState().fetchProfile();
        }
      } catch (err) {
        console.error('Onboarding bonus error:', err);
      }
    }

    completeOnboarding();
    navigate('/', { replace: true });
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
              {/* Illustration */}
              <div className="mb-8">
                <div className="w-40 h-40 mx-auto rounded-full gradient-primary flex items-center justify-center opacity-90">
                  <span className="text-7xl">🚶</span>
                </div>
              </div>

              <div className="glass-card p-8">
                {logoBreeva ? (
                  <img src={logoBreeva} alt="Breeva" className="h-10 w-auto mx-auto mb-2" />
                ) : (
                  <div className="text-3xl mb-2">🍃</div>
                )}
                <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-3">
                  Welcome to Breeva
                </h1>
                <p className="text-gray-500 dark:text-gray-400 text-sm leading-relaxed mb-8">
                  Earn real rewards for choosing healthier, eco-friendly routes. Walk more, earn EcoPoints, and redeem them at sustainable merchants.
                </p>

                <button
                  onClick={goNext}
                  className="w-full py-3.5 rounded-xl gradient-primary text-white font-semibold text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-200"
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
              <div className="mb-8 relative">
                <div className="w-32 h-32 mx-auto rounded-full bg-primary-100 dark:bg-primary-900/30 flex items-center justify-center">
                  <motion.div
                    animate={{ scale: [1, 1.2, 1] }}
                    transition={{ duration: 2, repeat: Infinity }}
                    className="text-6xl"
                  >
                    📍
                  </motion.div>
                </div>
                {/* Pulse rings */}
                <motion.div
                  animate={{ scale: [1, 1.5], opacity: [0.4, 0] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="absolute inset-0 mx-auto w-32 h-32 rounded-full border-2 border-primary-400"
                  style={{ top: 0 }}
                />
              </div>

              <div className="glass-card p-8">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                  Enable Location
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                  We use your location to power your eco-walks.
                </p>

                {/* Benefits Checklist */}
                <div className="text-left space-y-3 mb-8">
                  {[
                    'Find eco-merchants near you',
                    'Track your walking distance',
                    'Show real-time air quality',
                    'Calculate earned EcoPoints',
                  ].map((benefit) => (
                    <div key={benefit} className="flex items-center gap-3">
                      <div className="w-5 h-5 rounded-full gradient-primary flex items-center justify-center flex-shrink-0">
                        <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                        </svg>
                      </div>
                      <span className="text-sm text-gray-700 dark:text-gray-300">{benefit}</span>
                    </div>
                  ))}
                </div>

                <button
                  onClick={handleEnableLocation}
                  className="w-full py-3.5 rounded-xl gradient-primary text-white font-semibold text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 mb-3"
                >
                  Enable Location
                </button>
                <button
                  onClick={goNext}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300 dark:text-gray-600 transition-colors"
                >
                  Skip for now
                </button>
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
              <div className="mb-8">
                <div className="w-32 h-32 mx-auto rounded-full bg-accent-100 dark:bg-accent-900/30 flex items-center justify-center">
                  <motion.div
                    animate={{ rotate: [0, 10, -10, 0] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                    className="text-6xl"
                  >
                    📱
                  </motion.div>
                </div>
              </div>

              <div className="glass-card p-8">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                  Motion Tracking
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-4">
                  Allow motion access to verify your walks and earn full rewards.
                </p>

                <div className="glass-card mb-6 p-3 bg-accent-50 dark:bg-accent-900/20 border border-accent-200 dark:border-accent-800">
                  <p className="text-xs text-accent-700 dark:text-accent-400">
                    ⚠️ Without motion access, you'll earn reduced rewards (50% EcoPoints per walk).
                  </p>
                </div>

                <button
                  onClick={handleRequestMotion}
                  className="w-full py-3.5 rounded-xl gradient-primary text-white font-semibold text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 mb-3"
                >
                  Enable Motion
                </button>
                <button
                  onClick={goNext}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300 dark:text-gray-600 transition-colors"
                >
                  Skip for now
                </button>
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
              <div className="mb-8">
                <motion.div
                  animate={{ scale: [1, 1.05, 1] }}
                  transition={{ duration: 2, repeat: Infinity }}
                  className="w-40 h-40 mx-auto rounded-full gradient-premium flex items-center justify-center"
                >
                  <span className="text-7xl">🎁</span>
                </motion.div>
              </div>

              <div className="glass-card p-8">
                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-3">
                  Welcome Bonus!
                </h2>
                <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                  Complete your first walk and earn a special welcome bonus.
                </p>

                {/* Bonus Display */}
                <div className="glass-card p-5 mb-8 glow-accent">
                  <div className="text-3xl font-bold text-accent-500 mb-1">
                    +100 EcoPoints
                  </div>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    On your first completed walk
                  </p>
                </div>

                <button
                  onClick={handleFinish}
                  className="w-full py-3.5 rounded-xl gradient-primary text-white font-semibold text-sm shadow-lg hover:shadow-xl hover:scale-[1.02] active:scale-[0.98] transition-all duration-200 mb-3"
                >
                  Start My First Walk 🚶
                </button>
                <button
                  onClick={handleFinish}
                  className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:text-gray-400 dark:hover:text-gray-300 dark:text-gray-600 transition-colors"
                >
                  I'll do it later
                </button>
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
