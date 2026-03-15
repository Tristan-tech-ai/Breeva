import { useEffect, useRef } from 'react';

interface CelebrationBurstProps {
  /** Number of particles (default 40) */
  count?: number;
  /** Colors to randomly pick from */
  colors?: string[];
  /** Whether to trigger the burst */
  active: boolean;
}

/** Full-viewport confetti burst overlay — renders once then cleans up. */
export default function CelebrationBurst({
  count = 40,
  colors = ['#10b981', '#34d399', '#f59e0b', '#fbbf24', '#0ea5e9', '#a855f7'],
  active,
}: CelebrationBurstProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rafRef = useRef(0);

  useEffect(() => {
    if (!active) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = Array.from({ length: count }).map(() => ({
      x: canvas.width / 2 + (Math.random() - 0.5) * 60,
      y: canvas.height / 2,
      vx: (Math.random() - 0.5) * 12,
      vy: -8 - Math.random() * 10,
      size: 4 + Math.random() * 5,
      color: colors[Math.floor(Math.random() * colors.length)],
      rotation: Math.random() * 360,
      rotSpeed: (Math.random() - 0.5) * 10,
      life: 1,
    }));

    let frame = 0;
    const maxFrames = 90;

    function animate() {
      frame++;
      if (frame > maxFrames) {
        ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
        return;
      }

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      for (const p of particles) {
        p.x += p.vx;
        p.vy += 0.25; // gravity
        p.y += p.vy;
        p.rotation += p.rotSpeed;
        p.life = Math.max(0, 1 - frame / maxFrames);

        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate((p.rotation * Math.PI) / 180);
        ctx!.globalAlpha = p.life;
        ctx!.fillStyle = p.color;
        ctx!.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
        ctx!.restore();
      }

      rafRef.current = requestAnimationFrame(animate);
    }

    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, count, colors]);

  if (!active) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-[200] pointer-events-none"
      aria-hidden="true"
    />
  );
}
