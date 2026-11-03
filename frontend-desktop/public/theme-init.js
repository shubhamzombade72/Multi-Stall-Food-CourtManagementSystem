/* Classic script (no modules): sets the theme before first paint. Mirrors src/lib/theme.ts. Never throws. */
(function () {
  var theme = 'light';
  try {
    var stored = null;
    try {
      stored = localStorage.getItem('fc_theme');
    } catch (e) {
      stored = null;
    }
    if (stored === 'light' || stored === 'dark') {
      theme = stored;
    } else if (typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches) {
      theme = 'dark';
    }
    var root = document.documentElement;
    root.setAttribute('data-theme', theme);
    root.style.colorScheme = theme;
  } catch (e) {
    /* leave the default (light) theme */
  }
})();
