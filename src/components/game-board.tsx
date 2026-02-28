'use client';

interface GameBoardProps {
  board: (string | null)[];
  onCellClick: (cell: number) => void;
  winningCells: number[] | null;
  disabled: boolean;
}

export default function GameBoard({ board, onCellClick, winningCells, disabled }: GameBoardProps) {
  return (
    <div className="grid grid-cols-3 gap-1 w-64 h-64">
      {board.map((cell, i) => {
        const isWinning = winningCells?.includes(i);
        return (
          <button
            key={i}
            onClick={() => onCellClick(i)}
            disabled={disabled || cell !== null}
            className={`
              flex items-center justify-center text-3xl font-bold border border-gray-600
              ${cell === null && !disabled ? 'hover:bg-gray-800 cursor-pointer' : 'cursor-default'}
              ${isWinning ? 'bg-green-900 text-green-300' : 'bg-gray-900 text-white'}
              ${cell === 'X' ? 'text-blue-400' : cell === 'O' ? 'text-red-400' : ''}
            `}
          >
            {cell}
          </button>
        );
      })}
    </div>
  );
}
