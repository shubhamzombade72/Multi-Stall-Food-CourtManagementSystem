'use strict';
/**
 * Print document -> self-contained HTML for the Windows-driver transport (and its on-screen preview).
 * Everything is escaped; the page carries a CSP that forbids scripts, so even a malformed document cannot execute
 * anything. The OS renders the text with real fonts, which is why Marathi/Devanagari prints correctly this way.
 */
const PAPER_CSS = {
  58: { pageMm: 58, contentMm: 48, qrMaxMm: 36, fontPx: 11 },
  80: { pageMm: 80, contentMm: 72, qrMaxMm: 44, fontPx: 12 },
};

const FONT_STACK = "'Nirmala UI','Mangal','Noto Sans Devanagari','Segoe UI',Arial,sans-serif";

const esc = (s) =>
  String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

function qrSvg(modules, maxMm) {
  const n = modules.length;
  const quiet = 4;
  const total = n + quiet * 2;
  let path = '';
  for (let y = 0; y < n; y++) {
    const row = modules[y];
    for (let x = 0; x < n; x++) if (row[x] === '1') path += `M${x + quiet},${y + quiet}h1v1h-1z`;
  }
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${total}" width="${maxMm}mm" height="${maxMm}mm" ` +
    `shape-rendering="crispEdges" role="img" aria-label="QR code"><rect width="${total}" height="${total}" fill="#fff"/>` +
    `<path d="${path}" fill="#000"/></svg>`
  );
}

function blockHtml(b, paper) {
  switch (b.t) {
    case 'text': {
      const style = [`text-align:${b.align || 'left'}`, b.bold ? 'font-weight:700' : '', b.size === 'large' ? 'font-size:1.6em;line-height:1.2' : ''].filter(Boolean).join(';');
      return `<div class="t" style="${style}">${esc(b.text).replace(/\n/g, '<br>')}</div>`;
    }
    case 'row':
      return `<div class="r${b.bold ? ' b' : ''}"><span class="l">${esc(b.left)}</span><span class="v">${esc(b.right)}</span></div>`;
    case 'rule':
      return `<div class="rule ${b.style === 'double' ? 'dbl' : ''}"></div>`;
    case 'qr':
      return b.modules && b.modules.length
        ? `<div class="qr">${qrSvg(b.modules, paper.qrMaxMm)}</div>`
        : `<div class="t" style="text-align:center;word-break:break-all">${esc(b.data)}</div>`;
    case 'feed':
      return `<div style="height:${b.lines * 1.2}em"></div>`;
    default:
      return '';
  }
}

/** Full HTML document for the given paper width (58 or 80). `inline` omits @page for embedding in a preview iframe. */
function documentToHtml(doc, paperWidthMm, opts = {}) {
  const paper = PAPER_CSS[Number(paperWidthMm) === 58 ? 58 : 80];
  const body = doc.blocks.map((b) => blockHtml(b, paper)).join('\n');
  return `<!doctype html>
<html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">
<title>${esc(doc.title || 'Print')}</title>
<style>
${opts.inline ? '' : `@page { size: ${paper.pageMm}mm auto; margin: 0; }`}
html,body{margin:0;padding:0;background:#fff;color:#000}
body{width:${paper.contentMm}mm;padding:2mm ${(paper.pageMm - paper.contentMm) / 2}mm;font-family:${FONT_STACK};font-size:${paper.fontPx}px;line-height:1.3}
.t{word-break:break-word;overflow-wrap:anywhere}
.r{display:flex;justify-content:space-between;gap:6px}
.r .l{min-width:0;word-break:break-word}
.r .v{white-space:nowrap}
.r.b{font-weight:700}
.rule{border-top:1px dashed #000;margin:4px 0}
.rule.dbl{border-top:2px double #000}
.qr{text-align:center;margin:4px 0;break-inside:avoid}
</style></head>
<body data-paper="${paper.pageMm}">
${body}
</body></html>`;
}

module.exports = { documentToHtml, PAPER_CSS, qrSvg };
