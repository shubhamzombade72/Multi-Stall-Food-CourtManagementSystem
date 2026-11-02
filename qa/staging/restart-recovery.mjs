/**
 * Backend restart recovery check, in two phases around a manual API stop/start:
 *   node qa/staging/restart-recovery.mjs queue    # API on :8100 must be DOWN: queues an order, sync fails
 *   node qa/staging/restart-recovery.mjs resume   # API back UP: same device storage syncs exactly once
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { syncQueue, newIdempotencyKey } from '../../mobile-app/src/offline/syncEngine.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const DIR = join(HERE, 'results', 'device-storage');
const STORE = join(DIR, 'restart-device.json');
const TOKEN_FILE = join(DIR, 'restart-token.json');
mkdirSync(DIR, { recursive: true });
const API = 'http://127.0.0.1:8100/api';

const store = {
  getQueue: async () => (existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : []),
  updateQueueItem: async (id, u) => writeFileSync(STORE, JSON.stringify((await store.getQueue()).map((x) => (x.id === id ? { ...x, ...u } : x)))),
  removeQueueItem: async (id) => writeFileSync(STORE, JSON.stringify((await store.getQueue()).filter((x) => x.id !== id))),
};
const post = (token) => async (item) => {
  const r = await fetch(`${API}/orders`, {
    method: 'POST',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ table_id: item.table_id, order_type: 'dine_in', idempotency_key: item.id, items: item.items }),
  });
  return { status: r.status, data: await r.json().catch(() => ({})) };
};

const phase = process.argv[2];
if (phase === 'queue') {
  // Token obtained earlier while the server was up is reused (device stays logged in across a server restart)
  const { token } = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
  const order = { id: newIdempotencyKey('waiter'), sync_status: 'pending', retry_count: 0, table_id: 1, items: [{ menu_item_id: 1, quantity: 1 }] };
  writeFileSync(STORE, JSON.stringify([order]));
  const r = await syncQueue(store, post(token), { force: true });
  console.log(JSON.stringify({ phase, key: order.id, result: r, queue: await store.getQueue() }));
} else if (phase === 'login') {
  const r = await fetch(`${API}/auth/login`, { method: 'POST', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'waiter1@foodcourt.com', password: 'password123' }) });
  writeFileSync(TOKEN_FILE, JSON.stringify({ token: (await r.json()).data.token }));
  console.log(JSON.stringify({ phase, status: r.status }));
} else {
  const { token } = JSON.parse(readFileSync(TOKEN_FILE, 'utf8'));
  const r = await syncQueue(store, post(token), { force: true });
  console.log(JSON.stringify({ phase, result: r, queue: await store.getQueue() }));
}
