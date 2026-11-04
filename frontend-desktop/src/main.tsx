import React, { useState } from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { StartupScreen } from './components/StartupScreen';
import { initApiBaseUrl } from './api/client';
import { isDesktopApp, logError } from './desktop/bridge';
import { startSound } from './lib/sound/index';
import './index.css';

startSound();

window.addEventListener('error', (e) => logError(`Uncaught: ${e.message} at ${e.filename}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => logError(`Unhandled rejection: ${e.reason?.message || e.reason}`));

/**
 * The desktop build starts its services first (StartupScreen) and only then loads the app, so the sign-in
 * screen never appears before there is something to sign in to. The web build has nothing to start.
 */
const Root: React.FC = () => {
  const [ready, setReady] = useState(!isDesktopApp());
  if (!ready) {
    return (
      <StartupScreen
        onReady={() => {
          initApiBaseUrl().finally(() => setReady(true));
        }}
      />
    );
  }
  return <App />;
};

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
