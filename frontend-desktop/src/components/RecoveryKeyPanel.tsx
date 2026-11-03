import React, { useState } from 'react';
import { KeyRound, Printer } from 'lucide-react';
import { printPage } from '../desktop/bridge';
import logoImg from '../assets/logo.jpg';

/**
 * Shows the owner's recovery key exactly once. It is the only way back in if the owner password is
 * forgotten, so the owner must confirm having stored it before continuing. Only a hash is kept by the system.
 */
export const RecoveryKeyPanel: React.FC<{ recoveryKey: string; onDone: () => void; title?: string }> = ({ recoveryKey, onDone, title = 'Save your recovery key' }) => {
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(recoveryKey);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen bg-canvas flex flex-col justify-center items-center p-4">
      <div className="w-full max-w-md bg-surface rounded-lg shadow-2xl p-8 border border-line space-y-4">
        <div className="text-center">
          <div className="w-16 h-16 rounded-lg overflow-hidden border-2 border-st-ready mx-auto mb-3 bg-canvas">
            <img src={logoImg} alt="Logo" className="w-full h-full object-cover" />
          </div>
          <h2 className="text-xl font-bold text-fg flex items-center justify-center space-x-2">
            <KeyRound className="w-5 h-5" />
            <span>{title}</span>
          </h2>
        </div>
        <p className="text-sm text-fg">
          If you ever forget the owner password, this key is the <b>only</b> way to get back in. It is shown <b>only now</b> and cannot be looked up later. Print it or write it down and keep it somewhere safe, away from the cashier counter.
        </p>
        <p className="text-center font-mono text-lg tracking-wider font-bold bg-surface-2 border border-line rounded-lg py-3 select-all" data-testid="recovery-key">
          {recoveryKey}
        </p>
        <div className="flex justify-center gap-2">
          <button type="button" onClick={copy} className="px-3 py-1.5 border border-line text-xs font-bold rounded-lg">
            {copied ? 'Copied' : 'Copy'}
          </button>
          <button type="button" onClick={() => printPage('a4').catch(() => undefined)} className="px-3 py-1.5 border border-line text-xs font-bold rounded-lg flex items-center space-x-1">
            <Printer className="w-3.5 h-3.5" />
            <span>Print</span>
          </button>
        </div>
        <label className="flex items-start space-x-2 text-sm text-fg">
          <input id="recovery-saved" type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} className="mt-1" />
          <span>I have saved my recovery key in a safe place.</span>
        </label>
        <button
          type="button"
          disabled={!saved}
          onClick={onDone}
          className="w-full py-3 px-4 bg-primary text-primary-fg hover:opacity-90 font-semibold rounded-lg disabled:opacity-40 transition"
        >
          Continue
        </button>
      </div>
    </div>
  );
};
