/**
 * QR checkout submission guard.
 *
 * Kept free of React / axios imports so the exact production logic is exercised by Node tests
 * (`pnpm test`), including against a live staging API.
 *
 * Guarantees (the backend's unique idempotency_key remains the final authority):
 *  - Only one submission can be in flight: a second tap while the first is pending gets the SAME
 *    promise, synchronously, before React has re-rendered the disabled button.
 *  - One idempotency key per checkout attempt. Retrying the same cart after a timeout or a lost
 *    response reuses the key, so the server replays the original order instead of creating another.
 *  - A different cart (items or table) is a new checkout and gets a new key.
 *  - The key is cleared only after the server acknowledges the order (HTTP 200/201).
 *
 * The cart signature deliberately ignores customer name/phone: editing the name after a timed-out
 * attempt must not mint a new key, because the first attempt may already have been committed.
 */

export interface CheckoutItem {
  menu_item_id: number;
  quantity: number;
}

export interface CheckoutPayload {
  qr_token: string;
  order_type: 'dine_in' | 'takeaway';
  customer_name?: string | null;
  customer_phone?: string | null;
  items: CheckoutItem[];
}

export interface HttpResult {
  status: number;
  data: any;
}

/** Must resolve with the status for ANY server response and reject only when no response arrived. */
export type PostOrderFn = (body: CheckoutPayload & { idempotency_key: string }) => Promise<HttpResult>;

export type CheckoutResult =
  | { kind: 'success'; trackingToken: string; replayed: boolean; idempotencyKey: string }
  | { kind: 'rejected'; message: string; status: number }
  | { kind: 'retryable'; message: string };

export const NETWORK_RETRY_MESSAGE =
  'Connection to the food court server was lost. Your order may already have been received. ' +
  'Tap Confirm again without changing your cart: it will be sent only once.';

const defaultKey = (): string => {
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === 'function') {
    return `qr_${c.randomUUID()}`;
  }
  const rand = () => Math.random().toString(36).slice(2, 12);
  return `qr_${Date.now()}_${rand()}${rand()}${rand()}`;
};

export const cartSignature = (p: CheckoutPayload): string =>
  JSON.stringify({
    qr: p.qr_token,
    type: p.order_type,
    items: [...p.items]
      .map((i) => [i.menu_item_id, i.quantity])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]),
  });

export interface CheckoutSession {
  submit(payload: CheckoutPayload, post: PostOrderFn): Promise<CheckoutResult>;
  /** Key that the next submit of the same cart would use (null when no checkout is pending). */
  currentKey(): string | null;
  isSubmitting(): boolean;
}

export const createCheckoutSession = (newKey: () => string = defaultKey): CheckoutSession => {
  let key: string | null = null;
  let signature: string | null = null;
  let inFlight: Promise<CheckoutResult> | null = null;

  const run = async (payload: CheckoutPayload, post: PostOrderFn): Promise<CheckoutResult> => {
    const sig = cartSignature(payload);
    if (key === null || sig !== signature) {
      key = newKey();
      signature = sig;
    }
    const usedKey = key;

    let res: HttpResult;
    try {
      res = await post({ ...payload, idempotency_key: usedKey });
    } catch {
      // No response: the server may or may not have committed. Keep the key for the retry.
      return { kind: 'retryable', message: NETWORK_RETRY_MESSAGE };
    }

    if (res.status === 200 || res.status === 201) {
      const trackingToken = res.data?.data?.tracking_token;
      if (!trackingToken) {
        return { kind: 'retryable', message: 'The server reply was incomplete. Tap Confirm again.' };
      }
      // Acknowledged: this checkout is finished; the next cart starts a new one
      key = null;
      signature = null;
      return { kind: 'success', trackingToken, replayed: res.status === 200, idempotencyKey: usedKey };
    }

    if (res.status === 408 || res.status === 429 || res.status >= 500) {
      return {
        kind: 'retryable',
        message:
          res.status === 429
            ? 'Too many orders from this table right now. Please wait a minute and tap Confirm again.'
            : NETWORK_RETRY_MESSAGE,
      };
    }

    // The server refused this cart (e.g. item sold out, invalid QR). No order exists for this key.
    return {
      kind: 'rejected',
      status: res.status,
      message: res.data?.message || 'The order could not be accepted. Please check your cart.',
    };
  };

  return {
    submit(payload, post) {
      if (inFlight) {
        return inFlight;
      }
      inFlight = run(payload, post).finally(() => {
        inFlight = null;
      });
      return inFlight;
    },
    currentKey: () => key,
    isSubmitting: () => inFlight !== null,
  };
};
