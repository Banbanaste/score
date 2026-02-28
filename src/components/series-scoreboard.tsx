'use client';

interface SeriesScoreboardProps {
  series: {
    currentRound: number;
    maxRounds: number;
    wins: { X: number; O: number };
  };
  morale?: { X: number; O: number };
}

export default function SeriesScoreboard({ series, morale }: SeriesScoreboardProps) {
  const winsNeeded = 3;

  const renderDots = (wins: number, mark: 'X' | 'O') => {
    const dots = [];
    const moraleValue = morale ? morale[mark] : 0;
    for (let i = 0; i < winsNeeded; i++) {
      const isFilled = i < wins;
      let moraleClass = '';
      if (isFilled && morale) {
        if (moraleValue > 0) {
          moraleClass = ' animate-pulse opacity-90';
        } else if (moraleValue < -0.3) {
          moraleClass = ' opacity-60';
        }
      }
      dots.push(
        <span
          key={i}
          className={`inline-block w-3 h-3 rounded-full border ${
            isFilled
              ? 'bg-current border-current'
              : 'bg-transparent border-gray-500'
          }${moraleClass}`}
        />
      );
    }
    return dots;
  };

  return (
    <div className="bg-gray-900 border border-gray-700 rounded px-4 py-2 text-sm text-center space-y-1 w-64">
      <div className="text-gray-400 font-mono">
        Round {series.currentRound} of {series.maxRounds}
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-blue-400">
          <span className="font-bold text-base">X</span>
          <div className="flex gap-1">{renderDots(series.wins.X, 'X')}</div>
          <span className="font-mono text-white text-base">{series.wins.X}</span>
        </div>
        <span className="text-gray-600">—</span>
        <div className="flex items-center gap-2 text-red-400">
          <span className="font-mono text-white text-base">{series.wins.O}</span>
          <div className="flex gap-1">{renderDots(series.wins.O, 'O')}</div>
          <span className="font-bold text-base">O</span>
        </div>
      </div>
    </div>
  );
}
