import React from 'react';
import type { PreviewResult } from '../lib/print/types';

type Ok = Extract<PreviewResult, { ok: true; mode: 'text' | 'html' }>;

/**
 * Preview of what the configured thermal printer will receive. The text preview is produced by the same layout code
 * that builds the printer bytes (electron/printing/escpos.cjs), so line breaks, column widths and "?" substitutions
 * shown here are what the paper gets. The driver preview is the very page handed to Windows.
 */
export const ThermalPreview: React.FC<{ result: Ok }> = ({ result }) => (
  <div data-testid="thermal-preview" data-mode={result.mode}>
    {result.mode === 'text' ? (
      <div
        data-testid="thermal-preview-text"
        style={{ background: '#fff', color: '#000', fontFamily: "'Courier New', monospace", fontSize: 12, lineHeight: 1.25, width: `${result.columns + 2}ch`, padding: '4mm 1ch', margin: '0 auto', boxShadow: '0 0 0 1px #999', whiteSpace: 'pre', overflow: 'hidden' }}
      >
        {result.lines.map((l, i) => (
          <div key={i} style={{ fontWeight: l.bold ? 700 : 400, fontSize: l.large ? '200%' : '100%', lineHeight: l.large ? 1.1 : 1.25, minHeight: '1.25em', fontStyle: l.qr ? 'italic' : 'normal' }}>
            {l.text || ' '}
          </div>
        ))}
      </div>
    ) : (
      <iframe
        title="Receipt page preview"
        sandbox=""
        srcDoc={result.html}
        data-testid="thermal-preview-page"
        style={{ width: result.paperWidthMm === 58 ? '62mm' : '86mm', height: 520, border: '1px solid #999', background: '#fff', display: 'block', margin: '0 auto' }}
      />
    )}
    {result.unsupported.length > 0 && (
      <p role="alert" className="mt-2 text-xs text-warning-fg" data-testid="thermal-preview-warning">
        This printer mode cannot print these characters and will print "?" instead: {result.unsupported.join(' ')}. Choose "Windows printer (driver)" in Settings, Printers for Marathi/Devanagari.
      </p>
    )}
  </div>
);
