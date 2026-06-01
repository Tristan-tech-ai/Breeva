/** Deterministic gradient (135°) derived from a seed string — used for entities
 *  that have no avatar (regions, categories, achievements). */
export function emblemGradient(seed: string): { backgroundImage: string } {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) % 360;
  return { backgroundImage: `linear-gradient(135deg, hsl(${h} 68% 56%), hsl(${(h + 38) % 360} 70% 44%))` };
}

/** Gradient emblem showing the first letter of `label`. Size via className. */
export default function Emblem({ seed, label, className }: {
  seed: string;
  label?: string | null;
  className?: string;
}) {
  return (
    <div
      className={`flex items-center justify-center text-white font-extrabold ${className ?? ''}`}
      style={emblemGradient(seed)}
    >
      {label?.[0]?.toUpperCase() ?? '?'}
    </div>
  );
}
