'use client';

interface RoundSummary {
  round: number;
  winner: string;
  moves: number;
}

interface SeriesResultProps {
  seriesWinner: string | null;
  finalScore: { X: number; O: number };
  rounds: RoundSummary[];
  totalMoves: number;
  peakIntensity: number;
  onNewSeries: () => void;
}

export default function SeriesResult({
  seriesWinner,
  finalScore,
  rounds,
  totalMoves,
  peakIntensity,
  onNewSeries,
}: SeriesResultProps) {
  const isDraw = seriesWinner === null;
  const headline = isDraw ? 'SERIES DRAW!' : `${seriesWinner} WINS THE SERIES!`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80">
      <div className="bg-gray-900 border border-gray-600 rounded-lg px-8 py-6 text-center space-y-5 max-w-md w-full mx-4">
        <div
          className={`text-3xl font-bold ${
            isDraw
              ? 'text-yellow-400'
              : seriesWinner === 'X'
              ? 'text-blue-400'
              : 'text-red-400'
          }`}
        >
          {headline}
        </div>

        <div className="text-4xl font-mono text-white">
          {finalScore.X} — {finalScore.O}
        </div>

        <div className="border-t border-gray-700 pt-4 space-y-1 text-sm text-left">
          {rounds.map((r) => (
            <div key={r.round} className="flex justify-between text-gray-300">
              <span>
                R{r.round}:{' '}
                <span
                  className={
                    r.winner === 'draw'
                      ? 'text-yellow-400'
                      : r.winner === 'X'
                      ? 'text-blue-400'
                      : 'text-red-400'
                  }
                >
                  {r.winner === 'draw' ? 'Draw' : `${r.winner} won`}
                </span>
              </span>
              <span className="text-gray-500">{r.moves} moves</span>
            </div>
          ))}
        </div>

        <div className="border-t border-gray-700 pt-4 text-sm text-gray-400 space-y-1">
          <div>
            Peak intensity:{' '}
            <span className="text-white font-mono">
              {peakIntensity.toFixed(2)}
            </span>
          </div>
          <div>
            Total moves:{' '}
            <span className="text-white font-mono">{totalMoves}</span>
          </div>
        </div>

        <button
          onClick={onNewSeries}
          className="bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded font-bold transition-colors w-full"
        >
          New Series
        </button>
      </div>
    </div>
  );
}
