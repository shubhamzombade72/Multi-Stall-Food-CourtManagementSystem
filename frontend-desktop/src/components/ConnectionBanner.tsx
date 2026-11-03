import React from 'react';
import { useConnection } from '../hooks/useConnection';
import { WifiOff } from 'lucide-react';

/** Shown across the top whenever the food court server is unreachable; disappears on reconnection. */
export const ConnectionBanner: React.FC = () => {
  const { state } = useConnection();
  if (state !== 'offline') return null;
  return (
    <div role="alert" className="bg-danger-fg text-surface text-sm px-3 py-1.5 flex items-center justify-between">
      <span className="flex items-center space-x-2">
        <WifiOff className="w-4 h-4" />
        <span>The food court system is not responding. Orders and payments cannot be saved until it returns. Reconnecting automatically…</span>
      </span>
    </div>
  );
};
