import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { initApiBaseUrl } from './api/client';
import { logError } from './desktop/bridge';
import './index.css';

window.addEventListener('error', (e) => logError(`Uncaught: ${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => logError(`Unhandled rejection: ${e.reason?.message || e.reason}`));

// The desktop build reads its saved API address before the first request is made
initApiBaseUrl().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  );
});
