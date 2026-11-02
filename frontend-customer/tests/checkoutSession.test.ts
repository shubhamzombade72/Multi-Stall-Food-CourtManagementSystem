/**
 * Tests for the QR checkout duplicate-order guard (src/lib/checkoutSession.ts).
 *
 *   pnpm test                                          # unit tests only
 *   STAGING_API=http://<ip>:8100/api pnpm test         # + live tests against the staging backend
 *
 * Runs on Node's built-in test runner with TypeScript type stripping (Node >= 22.6).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCheckoutSession,
  NETWORK_RETRY_MESSAGE,
  type CheckoutPayload,
  type PostOrderFn,
} from '../src/lib/checkoutSession.ts';

const cart = (qty = 1): CheckoutPayload => ({
  qr_token: 'QR-T-01-TEST',
  order_type: 'dine_in',
  customer_name: 'Test',
  items: [
    { menu_item_id: 1, quantity: qty },
    { menu_item_id: 7, quantity: 2 },
  ],
});

let seq = 0;
const keys = () => `key-${++seq}`;
const ok = (status = 201) => ({ status, data: { success: true, data: { tracking_token: 'trk_abc' } } });
const deferred = <T>() => {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
};

test('double click: only one request is sent and both taps get the same result', async () => {
  const s = createCheckoutSession(keys);
  const gate = deferred<{ status: number; data: any }>();
  const sent: string[] = [];
  const post: PostOrderFn = (body) => {
    sent.push(body.idempotency_key);
    return gate.promise;
  };

  const first = s.submit(cart(), post);
  const second = s.submit(cart(), post); // second tap before the first resolves
  assert.equal(s.isSubmitting(), true);
  assert.equal(first, second, 'second tap must reuse the in-flight promise');
  gate.resolve(ok());
  const [a, b] = await Promise.all([first, second]);
  assert.equal(sent.length, 1);
  assert.equal(a.kind, 'success');
  assert.deepEqual(a, b);
  assert.equal(s.isSubmitting(), false);
});

test('network timeout then retry reuses the original idempotency key', async () => {
  const s = createCheckoutSession(keys);
  const sent: string[] = [];
  let call = 0;
  const post: PostOrderFn = async (body) => {
    sent.push(body.idempotency_key);
    if (++call === 1) throw new Error('timeout of 15000ms exceeded');
    return ok(200); // server replays the order it committed on the first attempt
  };

  const r1 = await s.submit(cart(), post);
  assert.equal(r1.kind, 'retryable');
  assert.equal(r1.kind === 'retryable' && r1.message, NETWORK_RETRY_MESSAGE);
  assert.equal(s.currentKey(), sent[0], 'key is kept after a failure');

  const r2 = await s.submit(cart(), post);
  assert.equal(r2.kind, 'success');
  assert.equal(sent.length, 2);
  assert.equal(sent[0], sent[1], 'retry must reuse the same key');
});

test('editing the customer name after a timeout does not mint a new key', async () => {
  const s = createCheckoutSession(keys);
  const sent: string[] = [];
  let call = 0;
  const post: PostOrderFn = async (body) => {
    sent.push(body.idempotency_key);
    if (++call === 1) throw new Error('Network Error');
    return ok(200);
  };
  await s.submit(cart(), post);
  await s.submit({ ...cart(), customer_name: 'Changed Name' }, post);
  assert.equal(sent[0], sent[1]);
});

test('server errors (5xx / 429) are retryable and keep the key', async () => {
  for (const status of [500, 503, 429, 408]) {
    const s = createCheckoutSession(keys);
    const r = await s.submit(cart(), async () => ({ status, data: { message: 'busy' } }));
    assert.equal(r.kind, 'retryable', `HTTP ${status}`);
    assert.notEqual(s.currentKey(), null);
  }
});

test('successful submission clears the checkout state', async () => {
  const s = createCheckoutSession(keys);
  const r = await s.submit(cart(), async () => ok(201));
  assert.equal(r.kind, 'success');
  assert.equal(r.kind === 'success' && r.trackingToken, 'trk_abc');
  assert.equal(r.kind === 'success' && r.replayed, false);
  assert.equal(s.currentKey(), null, 'key cleared only after acknowledgement');
});

test('duplicate response (HTTP 200 replay) is treated as success and flagged', async () => {
  const s = createCheckoutSession(keys);
  const r = await s.submit(cart(), async () => ok(200));
  assert.equal(r.kind, 'success');
  assert.equal(r.kind === 'success' && r.replayed, true);
});

test('a new checkout after success gets a new key', async () => {
  const s = createCheckoutSession(keys);
  const sent: string[] = [];
  const post: PostOrderFn = async (body) => {
    sent.push(body.idempotency_key);
    return ok();
  };
  await s.submit(cart(), post);
  await s.submit(cart(), post); // same items, but a brand-new order after the first succeeded
  assert.notEqual(sent[0], sent[1]);
});

test('changing the cart after a failure starts a new checkout key', async () => {
  const s = createCheckoutSession(keys);
  const sent: string[] = [];
  const post: PostOrderFn = async (body) => {
    sent.push(body.idempotency_key);
    throw new Error('Network Error');
  };
  await s.submit(cart(1), post);
  await s.submit(cart(3), post);
  assert.notEqual(sent[0], sent[1]);
});

test('business rejection (422) is reported with the server message', async () => {
  const s = createCheckoutSession(keys);
  const r = await s.submit(cart(), async () => ({ status: 422, data: { message: "Item 'X' is currently out of stock." } }));
  assert.equal(r.kind, 'rejected');
  assert.equal(r.kind === 'rejected' && r.message, "Item 'X' is currently out of stock.");
});

test('the QR table token is sent unchanged with every attempt', async () => {
  const s = createCheckoutSession(keys);
  const tokens: string[] = [];
  let call = 0;
  await s.submit(cart(), async (body) => {
    tokens.push(body.qr_token);
    if (++call === 1) throw new Error('x');
    return ok();
  });
  await s.submit(cart(), async (body) => {
    tokens.push(body.qr_token);
    return ok();
  });
  assert.deepEqual(tokens, ['QR-T-01-TEST', 'QR-T-01-TEST']);
});

// ---------------------------------------------------------------- live staging backend
const API = process.env.STAGING_API;
const live = API ? test : test.skip;

const livePost =
  (opts: { loseResponse?: boolean } = {}): PostOrderFn =>
  async (body) => {
    const res = await fetch(`${API}/public/orders`, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (opts.loseResponse) throw new Error('socket hang up (response lost)');
    return { status: res.status, data };
  };

const liveCart = async (): Promise<CheckoutPayload> => {
  const qr = process.env.STAGING_QR_TOKEN;
  assert.ok(qr, 'STAGING_QR_TOKEN must be set for live tests');
  const menu = await (await fetch(`${API}/public/qr/${qr}`)).json();
  const items = menu.data.stalls
    .map((s: any) => s.categories.flatMap((c: any) => c.menu_items)[0])
    .filter(Boolean)
    .slice(0, 2)
    .map((m: any) => ({ menu_item_id: m.id, quantity: 1 }));
  return { qr_token: qr!, order_type: 'dine_in', customer_name: 'Checkout guard live test', items };
};

const track = async (token: string) => (await fetch(`${API}/public/orders/track/${token}`)).json();

live('LIVE: double click sends one order to the real backend', async () => {
  const s = createCheckoutSession();
  const c = await liveCart();
  const [a, b] = await Promise.all([s.submit(c, livePost()), s.submit(c, livePost())]);
  assert.equal(a.kind, 'success');
  assert.deepEqual(a, b);
  const t = await track((a as any).trackingToken);
  assert.equal(t.data.kitchen_tickets.length, 2, 'one ticket per stall, created once');
});

live('LIVE: lost response then retry replays the same order (HTTP 200)', async () => {
  const s = createCheckoutSession();
  const c = await liveCart();
  const r1 = await s.submit(c, livePost({ loseResponse: true }));
  assert.equal(r1.kind, 'retryable');
  const r2 = await s.submit(c, livePost());
  assert.equal(r2.kind, 'success');
  assert.equal((r2 as any).replayed, true, 'server must replay, not create a second order');
});
