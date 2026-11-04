import React, { useMemo } from 'react';
import { upiQrFor, type PaperWidth } from '../lib/receiptModel';

/**
 * Renders a UPI payment QR as crisp vector modules: black on white with a 4-module quiet zone, drawn square so it is
 * never stretched. Colours are fixed (not themed) because scanners need dark-on-light in every theme and on paper.
 *
 *  - `paper` set: sized in millimetres for that thermal paper width (module = whole printer dots).
 *  - `sizePx` set: on-screen size (POS payment panel).
 */
export const UpiQr: React.FC<{ text: string; paper?: PaperWidth; sizePx?: number; label?: string }> = ({ text, paper, sizePx, label }) => {
  const built = useMemo(() => {
    try {
      return upiQrFor(text, paper ?? 80);
    } catch {
      return null;
    }
  }, [text, paper]);

  if (!built) return <div role="alert" style={{ fontSize: 11 }}>Could not generate the UPI QR code.</div>;
  const { qr, layout } = built;
  const quiet = (layout.units - qr.size) / 2;
  let d = '';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (!qr.modules[y][x]) continue;
      let run = 1;
      while (x + run < qr.size && qr.modules[y][x + run]) run++;
      d += `M${x + quiet} ${y + quiet}h${run}v1h-${run}z`;
      x += run - 1;
    }
  }
  const size = sizePx ? `${sizePx}px` : `${layout.sizeMm}mm`;
  return (
    <svg
      role="img"
      aria-label={label || 'UPI payment QR code'}
      data-testid="upi-qr"
      data-qr-text={text}
      data-qr-modules={qr.size}
      data-qr-size-mm={sizePx ? undefined : layout.sizeMm}
      viewBox={`0 0 ${layout.units} ${layout.units}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      style={{ display: 'block', margin: '4px auto', maxWidth: '100%', background: '#fff' }}
    >
      <rect width={layout.units} height={layout.units} fill="#fff" />
      <path d={d} fill="#000" />
    </svg>
  );
};
