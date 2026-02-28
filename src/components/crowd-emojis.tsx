'use client';

/**
 * Crowd emotion config keyed by morale range (-1 to 1).
 * Each key is the lower bound of a 0.2-wide bucket: [-1, -0.8), [-0.8, -0.6), … [0.8, 1].
 */
export const CROWD_EMOTION_CONFIG: Record<string, { label: string; emojis: string[] }> = {
  '-1': {
    label: 'boring_dead',
    emojis: ['😵‍💫', '😴', '🫠', '💤', '😪', '😑', '😐', '😶', '🥱', '😒'],
  },
  '-0.8': {
    label: 'bored_uninterested',
    emojis: ['😑', '😐', '😒', '🙄', '😶', '😴', '🥱', '😔', '😕', '😪'],
  },
  '-0.6': {
    label: 'mildly_disengaged',
    emojis: ['😒', '🙄', '😑', '😐', '😏', '😶', '😴', '😪', '😕', '🤷'],
  },
  '-0.4': {
    label: 'angry',
    emojis: ['😠', '😡', '🤬', '😤', '😾', '👿', '💢', '😬', '👊', '🔥'],
  },
  '-0.2': {
    label: 'neutral_watching',
    emojis: ['😶', '👀', '😐', '🤔', '😑', '😯', '🧐', '😏', '😕', '🤷‍♂️'],
  },
  '0': {
    label: 'slight_interest',
    emojis: ['🙂', '🤔', '😯', '😌', '😏', '👀', '🧐', '😬', '😐', '🤨'],
  },
  '0.2': {
    label: 'engaged',
    emojis: ['😮', '😯', '👀', '🤯', '😲', '😃', '🙂', '😬', '🤔', '😏'],
  },
  '0.4': {
    label: 'excited',
    emojis: ['😄', '😃', '😁', '🤩', '😆', '🤗', '😎', '😺', '🙌', '✨'],
  },
  '0.6': {
    label: 'happy',
    emojis: ['😁', '😊', '😄', '😍', '🥰', '😺', '😸', '😻', '👍', '💖'],
  },
  '0.8': {
    label: 'celebration',
    emojis: ['🥳', '🎉', '🎊', '🙌', '🔥', '💥', '🕺', '💃', '🏆', '🎆'],
  },
};

const THRESHOLDS = [-1, -0.8, -0.6, -0.4, -0.2, 0, 0.2, 0.4, 0.6, 0.8];

/**
 * Map morale (-1 to 1) to the config bucket key.
 */
export function getBucketKey(morale: number): string {
  const clamped = Math.max(-1, Math.min(1, morale));
  for (let i = THRESHOLDS.length - 1; i >= 0; i--) {
    if (clamped >= THRESHOLDS[i]) return String(THRESHOLDS[i]);
  }
  return '-1';
}

/** Get label and emojis for a morale value (for use in donut/arc layouts). */
export function getEmotionForMorale(morale: number): { label: string; emojis: string[] } {
  const key = getBucketKey(morale);
  return CROWD_EMOTION_CONFIG[key] ?? CROWD_EMOTION_CONFIG['0'];
}

interface CrowdEmojisProps {
  /** Morale from -1 to 1 (e.g. morale.X or morale.O) */
  morale: number;
  variant: 'blue' | 'red';
  slots?: number;
}

export default function CrowdEmojis({ morale, variant, slots = 10 }: CrowdEmojisProps) {
  const key = getBucketKey(morale);
  const config = CROWD_EMOTION_CONFIG[key] ?? CROWD_EMOTION_CONFIG['0'];
  const emojis = config.emojis;
  const label = config.label;

  return (
    <div
      className="flex flex-col items-center gap-1.5"
      data-variant={variant}
      aria-label={`Crowd: ${label}`}
    >
      <span
        className="text-[10px] sm:text-xs font-medium text-gray-400 uppercase tracking-wider"
        title={label}
      >
        {label}
      </span>
      <div className="grid grid-cols-2 gap-1.5 sm:gap-2">
        {Array.from({ length: slots }).map((_, i) => (
          <span
            key={i}
            className="text-2xl sm:text-3xl flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded bg-black/20"
          >
            {emojis[i % emojis.length]}
          </span>
        ))}
      </div>
    </div>
  );
}
