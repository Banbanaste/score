'use client';

interface GameStatusProps {
  roomId: string;
  myMark: string | null;
  currentTurn: string;
  status: string;
  winner: string | null;
}

export default function GameStatus({ roomId, myMark, currentTurn, status, winner }: GameStatusProps) {
  const isMyTurn = myMark === currentTurn;

  return (
    <div className="space-y-2 text-sm">
      <div className="font-mono bg-gray-800 px-3 py-1 rounded">
        Room: <span className="text-yellow-400 font-bold">{roomId}</span>
      </div>
      <div>You are: <span className="font-bold">{myMark || '...'}</span></div>
      {status === 'waiting' && (
        <div className="text-yellow-400">Waiting for opponent...</div>
      )}
      {status === 'active' && (
        <div className={isMyTurn ? 'text-green-400' : 'text-gray-400'}>
          {isMyTurn ? '>>> Your turn' : "Opponent's turn"}
        </div>
      )}
      {status === 'finished' && winner && (
        <div className="text-xl font-bold">
          {winner === 'draw' ? 'Draw!' : winner === myMark ? 'You win!' : 'You lose!'}
        </div>
      )}
    </div>
  );
}
