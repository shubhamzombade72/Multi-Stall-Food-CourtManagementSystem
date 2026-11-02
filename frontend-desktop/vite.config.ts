import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Production-only Content-Security-Policy. Scripts may only come from the app bundle; the API and Reverb
 * may live on any LAN host the operator configures, so connect-src allows http(s)/ws(s).
 * Not applied in `vite dev`, whose HMR preamble uses an inline script.
 */
const contentSecurityPolicy = (): Plugin => ({
  name: 'desktop-csp',
  apply: 'build',
  transformIndexHtml(html) {
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: http: https:",
      "font-src 'self' data:",
      "connect-src 'self' http: https: ws: wss:",
      "object-src 'none'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'",
    ].join('; ');
    return html.replace('<head>', `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`);
  },
});

export default defineConfig({
  // Relative asset paths so the same build loads from file:// inside Electron and from a web server
  base: './',
  plugins: [react(), contentSecurityPolicy()],
  server: {
    port: 3000,
    host: true,
  },
});
