'use client';

interface MoraleIndicatorProps {
  morale: { X: number; O: number };
  myMark: string | null;
}

function getMoraleLabel(value: number): string {
  if (value <= -0.7) return 'Despair';
  if (value <= -0.3) return 'Pressured';
  if (value <= 0.3) return 'Neutral';
  if (value <= 0.7) return 'Confident';
  return 'Dominant';
}

function getMoraleColor(value: number): string {
  if (value <= -0.7) return 'rgb(147, 51, 234)';   // purple-600
  if (value <= -0.3) return 'rgb(59, 130, 246)';    // blue-500
  if (value <= 0.3) return 'rgb(156, 163, 175)';    // gray-400
  if (value <= 0.7) return 'rgb(234, 179, 8)';      // yellow-500
  return 'rgb(34, 197, 94)';                         // green-500
}

function formatMorale(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

export { getMoraleLabel };

export default function MoraleIndicator({ morale, myMark }: MoraleIndicatorProps) {
  const players: Array<{ mark: 'X' | 'O'; color: string }> = [
    { mark: 'X', color: 'text-blue-400' },
    { mark: 'O', color: 'text-red-400' },
  ];

  return (
    <div className="w-full space-y-1.5">
      {players.map(({ mark, color }) => {
        const value = morale[mark];
        const label = getMoraleLabel(value);
        const barColor = getMoraleColor(value);
        const isMe = mark === myMark;
        // Fill percentage from center: abs(value) * 50 gives the fill width as % of half-bar
        const fillPct = Math.abs(value) * 50;
        const isPositive = value >= 0;

        return (
          <div key={mark} className="flex items-center gap-2 text-xs">
            <span className={`font-bold w-5 ${color}`}>
              {mark}
            </span>
            {isMe && (
              <span className="text-gray-500 text-[10px] w-6">You</span>
            )}
            {!isMe && <span className="w-6" />}

            {/* Center-origin bar */}
            <div className="flex-1 h-2.5 bg-gray-800 rounded overflow-hidden relative">
              {/* Center line */}
              <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-600 z-10" />

              {isPositive ? (
                /* Positive: fill right from center */
                <div
                  className="absolute top-0 bottom-0 rounded-r transition-all duration-500"
                  style={{
                    left: '50%',
                    width: `${fillPct}%`,
                    backgroundColor: barColor,
                  }}
                />
              ) : (
                /* Negative: fill left from center */
                <div
                  className="absolute top-0 bottom-0 rounded-l transition-all duration-500"
                  style={{
                    right: '50%',
                    width: `${fillPct}%`,
                    backgroundColor: barColor,
                  }}
                />
              )}
            </div>

            <span
              className="font-mono w-12 text-right"
              style={{ color: barColor }}
            >
              {formatMorale(value)}
            </span>
            <span className="text-gray-500 w-16 text-right hidden sm:inline">
              {label}
            </span>
          </div>
        );
      })}
    </div>
  );
}
