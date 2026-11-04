import { BrowserPlayer, installAudioUnlock } from './player.ts';
import { SoundService } from './service.ts';

/** The app-wide sound service. Import this; never create audio elements elsewhere. */
export const sound = new SoundService(new BrowserPlayer());

let installed = false;
/** Call once at startup (main.tsx). Safe to call again. */
export const startSound = (): void => {
  if (installed) return;
  installed = true;
  installAudioUnlock(() => sound.unlock());
};
