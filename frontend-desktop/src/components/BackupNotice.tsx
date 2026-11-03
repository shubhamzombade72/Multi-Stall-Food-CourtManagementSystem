import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { desktop, type BackupStatus } from '../desktop/bridge';
import { DatabaseBackup } from 'lucide-react';

const STALE_AFTER_MS = 48 * 60 * 60 * 1000;

/** Owner-only warning on a single-PC install when the automatic backup is failing or has stopped happening. */
export const BackupNotice: React.FC = () => {
  const { isOwner } = useAuth();
  const [status, setStatus] = useState<BackupStatus | null>(null);

  useEffect(() => {
    const d = desktop();
    if (!d || !isOwner) return;
    let alive = true;
    const load = () => d.getBackupStatus().then((s) => alive && setStatus(s)).catch(() => undefined);
    load();
    const t = setInterval(load, 10 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [isOwner]);

  if (!status || !status.available) return null;
  const last = status.lastBackupAt ? Date.parse(status.lastBackupAt) : null;
  const stale = last !== null && Date.now() - last > STALE_AFTER_MS;
  if (!status.lastError && !stale) return null;

  return (
    <div role="alert" className="bg-st-ready-soft text-st-ready-fg border-b border-st-ready text-sm px-3 py-1.5 flex items-center justify-between">
      <span className="flex items-center space-x-2">
        <DatabaseBackup className="w-4 h-4" />
        <span>{status.lastError ? `The last backup failed: ${status.lastError.message}` : 'No backup has been made for more than two days.'}</span>
      </span>
      <Link to="/settings" className="underline font-semibold">
        Open backups
      </Link>
    </div>
  );
};
