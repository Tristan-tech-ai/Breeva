/** Avatar with graceful initial fallback. Size via className (w-/h-/text-). */
export default function Avatar({ url, name, className }: {
  url?: string | null;
  name?: string | null;
  className?: string;
}) {
  return (
    <div className={`overflow-hidden bg-gray-200 dark:bg-gray-700 flex items-center justify-center ${className ?? ''}`}>
      {url ? (
        <img src={url} alt="" className="w-full h-full object-cover" loading="lazy" />
      ) : (
        <span className="font-bold text-gray-500 dark:text-gray-300">{name?.[0]?.toUpperCase() ?? '?'}</span>
      )}
    </div>
  );
}
