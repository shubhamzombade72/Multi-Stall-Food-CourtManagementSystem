import React from 'react';
import { Link } from 'react-router-dom';
import { useConnection } from '../hooks/useConnection';
import { WifiOff } from 'lucide-react';

/** Shown across the top whenever the food court server is unreachable; disappears on reconnection. */
export const ConnectionBanner: React.FC = () => {
  const { state } = useConnection();
  if (state !== 'offline') return null;
  return (
    <div role="alert" className="bg-rose-600 text-white text-sm px-4 py-2 flex items-center justify-between">
      <span className="flex items-center space-x-2">
        <WifiOff className="w-4 h-4" />
        <span>Server unreachable. Orders and payments cannot be saved until the connection returns. Retrying automatically…</span>
      </span>
      <Link to="/settings" className="underline font-semibold">Connection settings</Link>
    </div>
  );
};
