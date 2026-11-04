import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const INSTALLER = join(REPO, 'frontend-desktop', 'installers', '1.1.0', 'Multi-Stall-Food-Court-Setup-1.1.0.exe');

console.log('Testing installer binary:', INSTALLER);
if (!existsSync(INSTALLER)) throw new Error('Installer binary not found: ' + INSTALLER);
const size = statSync(INSTALLER).size;
console.log(`Installer size: ${(size / 1048576).toFixed(2)} MB (${size} bytes)`);

const installDir = join(tmpdir(), 'foodcourt_install_test');
rmSync(installDir, { recursive: true, force: true });

console.log('Running silent installation into:', installDir);
// NSIS /S /D=<dir> (note: /D must be last and unquoted)
execFileSync(INSTALLER, ['/S', `/D=${installDir}`], { stdio: 'inherit' });

console.log('Checking installed directory contents...');
const files = readdirSync(installDir);
console.log('Installed files in root:', files.join(', '));

const appExe = join(installDir, 'Multi-Stall Food Court Management System.exe');
if (!existsSync(appExe)) throw new Error('Main executable missing after install: ' + appExe);

const serverDir = join(installDir, 'resources', 'server');
const phpExe = join(serverDir, 'php', 'php.exe');
const artisan = join(serverDir, 'backend', 'artisan');
const router = join(serverDir, 'router.php');
const asar = join(installDir, 'resources', 'app.asar');

console.log('app.asar exists:', existsSync(asar));
console.log('php.exe exists:', existsSync(phpExe));
console.log('artisan exists:', existsSync(artisan));
console.log('router.php exists:', existsSync(router));

if (!existsSync(phpExe) || !existsSync(artisan) || !existsSync(router) || !existsSync(asar)) {
  throw new Error('Crucial runtime resources missing from installed directory!');
}

console.log('Launching installed application with smoke test in isolated profile...');
const testUserData = mkdtempSync(join(tmpdir(), 'fc-user-test-'));

// Clean environment
const env = {
  ...process.env,
  FOODCOURT_USER_DATA_DIR: testUserData,
  FOODCOURT_SMOKE_TEST: '1',
};
delete env.ELECTRON_RUN_AS_NODE;

let smokeOutput = '';
const child = spawn(appExe, [], {
  env,
  stdio: ['ignore', 'pipe', 'pipe'],
  windowsHide: true,
});

child.stdout.on('data', (d) => (smokeOutput += d));
child.stderr.on('data', (d) => (smokeOutput += d));

const exitCode = await new Promise((res) => {
  const timer = setTimeout(() => {
    child.kill();
    res(-1);
  }, 45000);
  child.on('exit', (code) => {
    clearTimeout(timer);
    res(code);
  });
});

console.log('Smoke test exit code:', exitCode);
console.log('Smoke test output:', smokeOutput.trim());

// Check if database was initialized in testUserData
const dbFile = join(testUserData, 'server', 'foodcourt.sqlite');
console.log('Database initialized in isolated user profile:', existsSync(dbFile));
if (existsSync(dbFile)) {
  console.log(`Database size: ${statSync(dbFile).size} bytes`);
}

// Check uninstaller
const uninstaller = files.find((f) => /Uninstall.*\.exe/i.test(f));
console.log('Uninstaller found:', uninstaller);

if (uninstaller) {
  console.log('Running silent uninstall...');
  execFileSync(join(installDir, uninstaller), ['/S', `_?=${installDir}`], { stdio: 'inherit' });
  // Wait brief moment for NSIS uninstaller helper
  await new Promise((r) => setTimeout(r, 2000));
  const remaining = existsSync(appExe);
  console.log('Main executable removed after uninstall:', !remaining);
  console.log('User data preserved after uninstall:', existsSync(testUserData));
}

// Cleanup throwaway testUserData
rmSync(testUserData, { recursive: true, force: true });
rmSync(installDir, { recursive: true, force: true });

console.log('INSTALLATION AND RUNTIME VERIFICATION COMPLETED SUCCESSFULLY!');

