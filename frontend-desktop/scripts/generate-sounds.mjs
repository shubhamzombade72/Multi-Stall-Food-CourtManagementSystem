/**
 * Renders the tone sequences in src/lib/sound/events.ts into 16-bit mono WAV files under public/sounds.
 * The sounds are original (plain oscillator tones written for this app), so there is no third-party audio licence
 * to track. Output is deterministic: re-running produces byte-identical files.
 *
 *   node scripts/generate-sounds.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SOUND_EVENTS, soundLength } from '../src/lib/sound/events.ts';

const RATE = 22050;
const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..', 'public', 'sounds');
mkdirSync(outDir, { recursive: true });

const wave = (type, phase) => {
  const s = Math.sin(2 * Math.PI * phase);
  if (type === 'sine') return s;
  if (type === 'square') return s >= 0 ? 1 : -1;
  return (2 / Math.PI) * Math.asin(s); // triangle
};

const render = (def) => {
  const n = Math.ceil(soundLength(def) * RATE);
  const buf = new Float32Array(n);
  for (const t of def.tones) {
    const start = Math.floor(t.start * RATE);
    const len = Math.floor(t.dur * RATE);
    const attack = Math.floor(0.01 * RATE);
    for (let i = 0; i < len && start + i < n; i++) {
      // 10 ms linear attack, then exponential decay to -60 dB at the end of the tone (same envelope as the live synth)
      const env = i < attack ? i / attack : Math.pow(0.001, (i - attack) / Math.max(1, len - attack));
      buf[start + i] += wave(t.wave, (t.freq * i) / RATE) * t.gain * env;
    }
  }
  return buf;
};

const toWav = (samples) => {
  const data = Buffer.alloc(samples.length * 2);
  samples.forEach((v, i) => data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, v)) * 32767), i * 2));
  const h = Buffer.alloc(44);
  h.write('RIFF', 0);
  h.writeUInt32LE(36 + data.length, 4);
  h.write('WAVEfmt ', 8);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); // PCM
  h.writeUInt16LE(1, 22); // mono
  h.writeUInt32LE(RATE, 24);
  h.writeUInt32LE(RATE * 2, 28);
  h.writeUInt16LE(2, 32);
  h.writeUInt16LE(16, 34);
  h.write('data', 36);
  h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
};

for (const def of Object.values(SOUND_EVENTS)) {
  const file = join(outDir, def.file);
  const wav = toWav(render(def));
  writeFileSync(file, wav);
  console.log(`${def.file}  ${wav.length} bytes`);
}
