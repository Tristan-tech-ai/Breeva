import { useRef, useCallback, type ReactNode, type MouseEvent } from 'react';

interface ClickSparkProps {
  children: ReactNode;
  color?: string;
  count?: number;
  className?: string;
}

/** Wraps children and spawns small particle sparks on click. */
export default function ClickSpark({ children, color = '#10b981', count = 8, className }: ClickSparkProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClick = useCallback((e: MouseEvent) => {
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    for (let i = 0; i < count; i++) {
      const spark = document.createElement('span');
      const angle = (360 / count) * i + (Math.random() * 30 - 15);
      const distance = 20 + Math.random() * 20;
      const size = 3 + Math.random() * 3;

      spark.style.cssText = `
        position: absolute;
        left: ${x}px;
        top: ${y}px;
        width: ${size}px;
        height: ${size}px;
        border-radius: 50%;
        background: ${color};
        pointer-events: none;
        z-index: 50;
        opacity: 1;
        transform: translate(-50%, -50%);
        transition: all 0.4s cubic-bezier(0.25, 0.46, 0.45, 0.94);
      `;

      container.appendChild(spark);

      requestAnimationFrame(() => {
        const rad = (angle * Math.PI) / 180;
        spark.style.transform = `translate(calc(-50% + ${Math.cos(rad) * distance}px), calc(-50% + ${Math.sin(rad) * distance}px))`;
        spark.style.opacity = '0';
      });

      setTimeout(() => spark.remove(), 450);
    }
  }, [color, count]);

  return (
    <div ref={containerRef} className={`relative overflow-hidden ${className || ''}`} onClick={handleClick}>
      {children}
    </div>
  );
}
