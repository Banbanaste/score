'use client';

interface RoundResultOverlayProps {
  winner: string | null;
  round: number;
  series: { wins: { X: number; O: number } };
  countdown: number | null;
  onDismiss?: () => void;
}

export default function RoundResultOverlay({
  winner,
  round,
  series,
  countdown,
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

        {countdown !== null && countdown > 0 && (
          <div className="text-gray-400 text-sm font-mono">
            Next round in {countdown}...
          </div>
        )}
      </div>
    </div>
  );
}
