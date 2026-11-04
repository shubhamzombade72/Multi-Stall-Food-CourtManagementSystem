import { execFileSync, spawn } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const BACKEND = join(REPO, 'backend');
const ROUTER = join(BACKEND, 'vendor', 'laravel', 'framework', 'src', 'Illuminate', 'Foundation', 'resources', 'server.php');

console.log('Migrating fresh and seeding foodcourt_desktop_e2e_db...');
execFileSync('php', ['artisan', 'migrate:fresh', '--seed', '--force'], {
  cwd: BACKEND,
  env: { ...process.env, APP_ENV: 'desktope2e' },
  stdio: 'inherit'
});

console.log('Starting PHP server on port 8110...');
const server = spawn('php', ['-S', '127.0.0.1:8110', '-t', join(BACKEND, 'public'), ROUTER], {
  cwd: join(BACKEND, 'public'),
  env: { ...process.env, APP_ENV: 'desktope2e' },
  stdio: 'inherit',
  windowsHide: true,
});

const waitUp = async (ms = 15000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const r = await fetch('http://127.0.0.1:8110/up').catch(() => null);
    if (r && r.status === 200) return true;
    await new Promise((r2) => setTimeout(r2, 200));
  }
  return false;
};

(async () => {
  const up = await waitUp();
  if (!up) {
    server.kill();
    throw new Error('Server 8110 failed to start');
  }

  console.log('Running qa/desktop/desktop-e2e.mjs...');
  try {
    execFileSync('node', ['qa/desktop/desktop-e2e.mjs'], {
      cwd: REPO,
      env: { ...process.env, E2E_API: 'http://127.0.0.1:8110/api', PGPASSWORD: 'root' },
      stdio: 'inherit'
    });
  } finally {
    server.kill();
  }
})();

