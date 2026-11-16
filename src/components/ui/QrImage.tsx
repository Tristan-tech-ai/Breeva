import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// Renders a real scannable QR (PNG data-URL). Import this via React.lazy so the `qrcode`
// lib only loads where a voucher QR is actually shown.
export default function QrImage({
  value, size = 168, className, alt = 'QR voucher',
}: {
  value: string;
  size?: number;
  className?: string;
  alt?: string;
}) {
  const [src, setSrc] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    QRCode.toDataURL(value, { width: size, margin: 1, errorCorrectionLevel: 'M', color: { dark: '#0f172a', light: '#ffffff' } })
      .then((url) => { if (active) setSrc(url); })
      .catch(() => { if (active) setSrc(null); });
    return () => { active = false; };
  }, [value, size]);

  if (!src) return <div className={className} style={{ width: size, height: size }} aria-hidden />;
  return <img src={src} width={size} height={size} alt={alt} className={className} />;
}
