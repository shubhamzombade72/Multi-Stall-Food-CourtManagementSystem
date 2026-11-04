import React, { useState } from 'react';
import { Volume2 } from 'lucide-react';
import { useSoundSettings } from '../hooks/useSoundSettings';
import { sound } from '../lib/sound/index';
import { SOUND_CATEGORIES, SOUND_EVENTS, type SoundEventId } from '../lib/sound/events';
import type { PlayOutcome } from '../lib/sound/service';

const outcomeText = (o: PlayOutcome): string | null => {
  if (o === 'played' || o === 'played-fallback') return null;
  if (o === 'silent') return 'Volume is at 0.';
  if (o === 'locked') return 'Windows or the browser blocked audio. Click anywhere on the page and test again.';
  return 'The sound could not be played on this computer.';
};

/** Per-computer sound preferences: master switch, volume, and the groups that make operational sense to mute. */
export const SoundSettingsSection: React.FC = () => {
  const { settings, update, setCategory } = useSoundSettings();
  const [message, setMessage] = useState<string | null>(null);

  const test = async (id: SoundEventId) => {
    setMessage(outcomeText(await sound.preview(id)));
  };

  return (
    <section className="space-y-2" data-testid="sound-settings">
      <h2 className="text-base font-semibold flex items-center space-x-2">
        <Volume2 className="w-5 h-5" />
        <span>Sound</span>
      </h2>
      <p className="text-xs text-muted">
        Sounds play only for real events (new order, kitchen ticket, order ready, payment, alerts), never for clicks. These settings are for this computer only.
      </p>
      <label className="flex items-center space-x-2 text-sm">
        <input
          type="checkbox"
          data-testid="sound-enabled"
          checked={settings.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
        />
        <span className="font-semibold">Play sounds on this computer</span>
      </label>
      <div className="flex items-center space-x-3 text-sm">
        <label htmlFor="sound-volume" className="font-semibold w-16">
          Volume
        </label>
        <input
          id="sound-volume"
          data-testid="sound-volume"
          type="range"
          min={0}
          max={100}
          step={5}
          value={Math.round(settings.volume * 100)}
          disabled={!settings.enabled}
          onChange={(e) => update({ volume: Number(e.target.value) / 100 })}
          className="flex-1"
        />
        <span className="w-10 text-right tabular-nums">{Math.round(settings.volume * 100)}%</span>
      </div>
      <div className="divide-y divide-line border border-line rounded-lg">
        {SOUND_CATEGORIES.map((c) => (
          <div key={c.id} className="p-2 space-y-1">
            <label className="flex items-center space-x-2 text-sm">
              <input
                type="checkbox"
                data-testid={`sound-category-${c.id}`}
                checked={settings.categories[c.id]}
                disabled={!settings.enabled}
                onChange={(e) => setCategory(c.id, e.target.checked)}
              />
              <span className="font-semibold">{c.label}</span>
              <span className="text-xs text-muted">{c.hint}</span>
            </label>
            <div className="flex flex-wrap gap-2 pl-6">
              {Object.values(SOUND_EVENTS)
                .filter((e) => e.category === c.id)
                .map((e) => (
                  <button
                    key={e.id}
                    type="button"
                    data-testid={`sound-test-${e.id}`}
                    title={e.description}
                    onClick={() => test(e.id)}
                    className="px-2 py-1 text-xs font-bold border border-line rounded-lg hover:bg-surface-2"
                  >
                    Test: {e.label}
                  </button>
                ))}
            </div>
          </div>
        ))}
      </div>
      {message && (
        <p role="status" className="text-xs text-danger-fg" data-testid="sound-message">
          {message}
        </p>
      )}
    </section>
  );
};
