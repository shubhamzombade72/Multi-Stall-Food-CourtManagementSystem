/**
 * The complete list of sounds this app can make. Every entry is tied to a real business event; there are
 * deliberately no sounds for buttons or navigation.
 *
 * Each sound is described as a short tone sequence. The same description is used twice: scripts/generate-sounds.mjs
 * renders it into the WAV files shipped in public/sounds, and the player synthesises it live if a file cannot be
 * loaded. So a missing or corrupt asset degrades to an identical sound instead of silence.
 */
export type SoundEventId = 'new_order' | 'kitchen_ticket' | 'order_ready' | 'payment_success' | 'payment_failed' | 'alert';

/** Groups that can be switched off independently (a kitchen PC wants kitchen sounds only, a till wants payments). */
export type SoundCategory = 'orders' | 'kitchen' | 'payments' | 'alerts';

export interface Tone {
  /** Hz */
  freq: number;
  /** seconds from the start of the sound */
  start: number;
  /** seconds */
  dur: number;
  wave: 'sine' | 'square' | 'triangle';
  /** peak amplitude 0..1 before the user's volume is applied */
  gain: number;
}

export interface SoundEventDef {
  id: SoundEventId;
  category: SoundCategory;
  label: string;
  /** What actually triggers it, shown next to the toggle */
  description: string;
  /** file name inside public/sounds */
  file: string;
  /** the same event cannot sound again within this window, whatever its key */
  cooldownMs: number;
  tones: Tone[];
}

export const SOUND_EVENTS: Record<SoundEventId, SoundEventDef> = {
  new_order: {
    id: 'new_order',
    category: 'orders',
    label: 'New order',
    description: 'A new order reaches the cashier or owner',
    file: 'new-order.wav',
    cooldownMs: 1500,
    tones: [
      { freq: 784, start: 0, dur: 0.14, wave: 'triangle', gain: 0.5 },
      { freq: 1046.5, start: 0.16, dur: 0.22, wave: 'triangle', gain: 0.5 },
    ],
  },
  kitchen_ticket: {
    id: 'kitchen_ticket',
    category: 'kitchen',
    label: 'New kitchen ticket',
    description: 'A new ticket arrives for a stall kitchen',
    file: 'kitchen-ticket.wav',
    cooldownMs: 1500,
    tones: [
      { freq: 1046.5, start: 0, dur: 0.09, wave: 'square', gain: 0.35 },
      { freq: 1046.5, start: 0.14, dur: 0.09, wave: 'square', gain: 0.35 },
    ],
  },
  order_ready: {
    id: 'order_ready',
    category: 'orders',
    label: 'Order ready',
    description: 'A stall marks a ticket ready for pickup',
    file: 'order-ready.wav',
    cooldownMs: 1500,
    tones: [
      { freq: 659.3, start: 0, dur: 0.12, wave: 'sine', gain: 0.55 },
      { freq: 880, start: 0.12, dur: 0.12, wave: 'sine', gain: 0.55 },
      { freq: 1318.5, start: 0.24, dur: 0.3, wave: 'sine', gain: 0.55 },
    ],
  },
  payment_success: {
    id: 'payment_success',
    category: 'payments',
    label: 'Payment received',
    description: 'A payment is recorded at the till',
    file: 'payment-success.wav',
    cooldownMs: 800,
    tones: [
      { freq: 784, start: 0, dur: 0.16, wave: 'triangle', gain: 0.6 },
      { freq: 1046.5, start: 0.14, dur: 0.16, wave: 'triangle', gain: 0.6 },
      { freq: 1568, start: 0.28, dur: 0.4, wave: 'triangle', gain: 0.6 },
    ],
  },
  payment_failed: {
    id: 'payment_failed',
    category: 'payments',
    label: 'Payment failed',
    description: 'The server refuses a payment at the till',
    file: 'payment-failed.wav',
    cooldownMs: 800,
    tones: [
      { freq: 330, start: 0, dur: 0.18, wave: 'square', gain: 0.35 },
      { freq: 247, start: 0.2, dur: 0.3, wave: 'square', gain: 0.35 },
    ],
  },
  alert: {
    id: 'alert',
    category: 'alerts',
    label: 'Alert',
    description: 'An order is cancelled, or a print job fails',
    file: 'alert.wav',
    cooldownMs: 3000,
    tones: [
      { freq: 880, start: 0, dur: 0.12, wave: 'square', gain: 0.3 },
      { freq: 698.5, start: 0.16, dur: 0.12, wave: 'square', gain: 0.3 },
      { freq: 880, start: 0.32, dur: 0.12, wave: 'square', gain: 0.3 },
    ],
  },
};

export const SOUND_EVENT_IDS = Object.keys(SOUND_EVENTS) as SoundEventId[];

export const SOUND_CATEGORIES: { id: SoundCategory; label: string; hint: string }[] = [
  { id: 'orders', label: 'Orders', hint: 'New orders and ready-for-pickup alerts' },
  { id: 'kitchen', label: 'Kitchen', hint: 'New tickets on a stall kitchen screen' },
  { id: 'payments', label: 'Payments', hint: 'Payment received / refused at the till' },
  { id: 'alerts', label: 'Alerts', hint: 'Cancelled orders and failed print jobs' },
];

/** Total length of a sound in seconds (used by the generator and the synth fallback). */
export const soundLength = (def: SoundEventDef): number => Math.max(...def.tones.map((t) => t.start + t.dur)) + 0.05;
