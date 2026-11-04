import { useSyncExternalStore } from 'react';
import { sound } from '../lib/sound/index.ts';

/** Live view of this PC's sound settings (re-renders when they change anywhere). */
export const useSoundSettings = () => {
  const settings = useSyncExternalStore(sound.subscribe, sound.getSettings, sound.getSettings);
  return { settings, update: sound.update.bind(sound), setCategory: sound.setCategory.bind(sound) };
};
