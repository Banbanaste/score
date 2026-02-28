'use client';

const EMOJI_BY_INTENSITY: Record<string, string[]> = {
  low: ['😭', '😫', '😢', '😠', '😤', '😞', '😩', '😒', '🙁', '😣'],
  midLow: ['😐', '😕', '🙂', '😶', '😑', '🥲', '😬', '😅', '😓', '😔'],
  midHigh: ['🙂', '😊', '😄', '🙃', '😌', '😁', '👍', '👏', '🤝', '💪'],
  high: ['😀', '😊', '🎉', '🙌', '😄', '🤩', '👍', '😁', '🥳', '🔥'],
};

// Intensity from server is 0.0–1.0 (see types.ts / intensity.ts)
function getTier(intensity: number): keyof typeof EMOJI_BY_INTENSITY {
  if (intensity < 0.25) return 'low';
  if (intensity < 0.5) return 'midLow';
  if (intensity < 0.75) return 'midHigh';
  return 'high';
}

interface CrowdEmojisProps {
  intensity: number;
  variant: 'blue' | 'red';
  slots?: number;
}

export default function CrowdEmojis({ intensity, variant, slots = 10 }: CrowdEmojisProps) {
  const tier = getTier(intensity);
  const emojis = EMOJI_BY_INTENSITY[tier];

  return (
    <div
      className="grid grid-cols-2 gap-1.5 sm:gap-2"
      data-variant={variant}
      aria-label={`Crowd reaction: ${tier} intensity`}
    >
      {Array.from({ length: slots }).map((_, i) => (
        <span
          key={i}
          className="text-2xl sm:text-3xl flex items-center justify-center w-8 h-8 sm:w-9 sm:h-9 rounded bg-black/20"
        >
          {emojis[i % emojis.length]}
        </span>
      ))}
    </div>
  );
}
