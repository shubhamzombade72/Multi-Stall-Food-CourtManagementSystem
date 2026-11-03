/** Semantic colour tokens live in src/index.css as --c-<name> RGB channels (light on :root, dark on [data-theme="dark"]). */
const token = (name) => `rgb(var(--c-${name}) / <alpha-value>)`;

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Segoe UI"', 'Inter', 'Roboto', 'system-ui', '-apple-system', 'sans-serif'],
      },
      colors: {
        canvas: token('canvas'),
        surface: { DEFAULT: token('surface'), 2: token('surface-2') },
        sidebar: token('sidebar'),
        fg: token('fg'),
        muted: token('muted'),
        subtle: token('subtle'),
        line: token('line'),
        primary: { DEFAULT: token('primary'), fg: token('primary-fg') },
        success: { DEFAULT: token('success'), fg: token('success-fg') },
        warning: { DEFAULT: token('warning'), fg: token('warning-fg') },
        danger: { DEFAULT: token('danger'), fg: token('danger-fg') },
        info: { DEFAULT: token('info'), fg: token('info-fg') },
        focus: token('focus'),
        'st-pending': { DEFAULT: token('st-pending'), soft: token('st-pending-soft'), fg: token('st-pending-fg') },
        'st-running': { DEFAULT: token('st-running'), soft: token('st-running-soft'), fg: token('st-running-fg') },
        'st-cooking': { DEFAULT: token('st-cooking'), soft: token('st-cooking-soft'), fg: token('st-cooking-fg') },
        'st-ready': { DEFAULT: token('st-ready'), soft: token('st-ready-soft'), fg: token('st-ready-fg') },
        'st-served': { DEFAULT: token('st-served'), soft: token('st-served-soft'), fg: token('st-served-fg') },
        'st-settled': { DEFAULT: token('st-settled'), soft: token('st-settled-soft'), fg: token('st-settled-fg') },
        'st-kitchen': { DEFAULT: token('st-kitchen'), soft: token('st-kitchen-soft'), fg: token('st-kitchen-fg') },
        'st-void': { DEFAULT: token('st-void'), soft: token('st-void-soft'), fg: token('st-void-fg') },
        'st-cancelled': { DEFAULT: token('st-cancelled'), soft: token('st-cancelled-soft'), fg: token('st-cancelled-fg') },
      },
    },
  },
  plugins: [],
}
