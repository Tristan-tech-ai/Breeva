import { useState, useEffect, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ChevronRight, ChevronLeft } from 'lucide-react';

export interface TourStep {
  /** CSS selector for the target element to highlight */
  target: string;
  /** Title of this tour step */
  title: string;
  /** Description of what this feature does */
  description: string;
}

interface OnboardingTourProps {
  /** Unique ID for this tour (persisted to localStorage) */
  tourId: string;
  /** Steps of the tour */
  steps: TourStep[];
  /** Delay before showing tour (ms) */
  delay?: number;
}

const STORAGE_PREFIX = 'breeva_tour_';

export default function OnboardingTour({ tourId, steps, delay = 1500 }: OnboardingTourProps) {
  const [active, setActive] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [tooltipStyle, setTooltipStyle] = useState<React.CSSProperties>({});
  const [highlightStyle, setHighlightStyle] = useState<React.CSSProperties>({});
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Check if tour was already completed
  useEffect(() => {
    const seen = localStorage.getItem(`${STORAGE_PREFIX}${tourId}`);
    if (seen) return;
    timerRef.current = setTimeout(() => setActive(true), delay);
    return () => clearTimeout(timerRef.current);
  }, [tourId, delay]);

  // Position tooltip relative to targeted element
  const positionTooltip = useCallback(() => {
    if (!active || !steps[currentStep]) return;
    const el = document.querySelector(steps[currentStep].target);
    if (!el) return;

    const rect = el.getBoundingClientRect();
    const pad = 8;

    // Highlight overlay position
    setHighlightStyle({
      top: rect.top - pad,
      left: rect.left - pad,
      width: rect.width + pad * 2,
      height: rect.height + pad * 2,
    });

    // Tooltip below if space, otherwise above
    const tooltipWidth = Math.min(320, window.innerWidth - 32);
    const spaceBelow = window.innerHeight - rect.bottom;
    const top = spaceBelow > 180
      ? rect.bottom + pad + 8
      : rect.top - pad - 160;

    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - tooltipWidth - 16));

    setTooltipStyle({ top, left, width: tooltipWidth });
  }, [active, currentStep, steps]);

  useEffect(() => {
    positionTooltip();
    window.addEventListener('resize', positionTooltip);
    window.addEventListener('scroll', positionTooltip, true);
    return () => {
      window.removeEventListener('resize', positionTooltip);
      window.removeEventListener('scroll', positionTooltip, true);
    };
  }, [positionTooltip]);

  const completeTour = useCallback(() => {
    localStorage.setItem(`${STORAGE_PREFIX}${tourId}`, '1');
    setActive(false);
  }, [tourId]);

  const next = () => {
    if (currentStep < steps.length - 1) {
      setCurrentStep(prev => prev + 1);
    } else {
      completeTour();
    }
  };

  const prev = () => {
    if (currentStep > 0) setCurrentStep(prev => prev - 1);
  };

  if (!active) return null;

  return createPortal(
    <AnimatePresence>
      {active && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[9998] bg-black/50"
            onClick={completeTour}
          />

          {/* Highlight cutout */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed z-[9999] rounded-xl border-2 border-primary-400 pointer-events-none"
            style={{ ...highlightStyle, boxShadow: '0 0 0 9999px rgba(0,0,0,0.5)' }}
          />

          {/* Tooltip */}
          <motion.div
            key={currentStep}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="fixed z-[10000] rounded-2xl bg-white dark:bg-gray-900 shadow-2xl border border-gray-200 dark:border-gray-700 p-4"
            style={tooltipStyle}
          >
            <button
              onClick={completeTour}
              className="absolute top-3 right-3 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            >
              <X className="w-4 h-4" />
            </button>

            <h4 className="text-sm font-semibold text-gray-900 dark:text-white pr-6">
              {steps[currentStep].title}
            </h4>
            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 leading-relaxed">
              {steps[currentStep].description}
            </p>

            <div className="flex items-center justify-between mt-4">
              {/* Step dots */}
              <div className="flex gap-1">
                {steps.map((_, i) => (
                  <div
                    key={i}
                    className={`w-1.5 h-1.5 rounded-full transition-colors ${i === currentStep ? 'bg-primary-500' : 'bg-gray-300 dark:bg-gray-600'}`}
                  />
                ))}
              </div>

              <div className="flex items-center gap-2">
                {currentStep > 0 && (
                  <button
                    onClick={prev}
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800"
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                )}
                <button
                  onClick={next}
                  className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary-500 text-white text-xs font-medium hover:bg-primary-600 transition-colors"
                >
                  {currentStep === steps.length - 1 ? 'Got it!' : 'Next'}
                  {currentStep < steps.length - 1 && <ChevronRight className="w-3 h-3" />}
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}
