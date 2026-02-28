'use client';

function getMoraleLabel(value: number): string {
  if (value <= -0.7) return 'Despair';
  if (value <= -0.3) return 'Pressured';
  if (value <= 0.3) return 'Neutral';
  if (value <= 0.7) return 'Confident';
  return 'Dominant';
}

function getMoraleColor(value: number): string {
  if (value <= -0.7) return 'text-purple-400';
  if (value <= -0.3) return 'text-blue-300';
  if (value <= 0.3) return 'text-gray-400';
  if (value <= 0.7) return 'text-yellow-400';
  return 'text-green-400';
}

function formatMorale(value: number): string {
  const sign = value >= 0 ? '+' : '';
  return `${sign}${value.toFixed(2)}`;
}

interface RoundResultOverlayProps {
  winner: string | null;
  round: number;
  series: { wins: { X: number; O: number } };
  countdown: number | null;
  morale?: { X: number; O: number };
  onDismiss?: () => void;
}

export default function RoundResultOverlay({
  winner,
  round,
  series,
  countdown,
  morale,
  onDismiss,
}: RoundResultOverlayProps) {
  const isDraw = winner === 'draw';
  const headline = isDraw
    ? `Round ${round} is a draw!`
    : `${winner} wins Round ${round}!`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70"
      onClick={onDismiss}
    >
      <div
        className="bg-gray-900 border border-gray-600 rounded-lg px-8 py-6 text-center space-y-4 max-w-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className={`text-2xl font-bold ${
            isDraw
              ? 'text-yellow-400'
              : winner === 'X'
              ? 'text-blue-400'
              : 'text-red-400'
          }`}
        >
          {headline}
        </div>

        <div className="text-lg text-gray-300">
          <span className="text-blue-400 font-bold">X</span>{' '}
          <span className="font-mono text-white text-xl">{series.wins.X}</span>
          <span className="text-gray-500 mx-2">—</span>
          <span className="font-mono text-white text-xl">{series.wins.O}</span>{' '}
          <span className="text-red-400 font-bold">O</span>
        </div>

        {morale && (
          <div className="flex justify-center gap-4 text-xs font-mono">
            <span>
              <span className="text-blue-400 font-bold">X</span>
              {': '}
              <span className={getMoraleColor(morale.X)}>
                {getMoraleLabel(morale.X)} ({formatMorale(morale.X)})
              </span>
            </span>
            <span>
              <span className="text-red-400 font-bold">O</span>
              {': '}
              <span className={getMoraleColor(morale.O)}>
                {getMoraleLabel(morale.O)} ({formatMorale(morale.O)})
              </span>
            </span>
          </div>
        )}

        {countdown !== null && countdown > 0 && (
          <div className="text-gray-400 text-sm font-mono">
            Next round in {countdown}...
          </div>
        )}
      </div>
    </div>
  );
}
