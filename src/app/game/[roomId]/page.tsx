'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSocket } from '@/hooks/use-socket';
import GameBoard from '@/components/game-board';
import GameStatus from '@/components/game-status';
import IntensityMeter from '@/components/intensity-meter';
import ConnectionStatus from '@/components/connection-status';
import EventDebugPanel from '@/components/event-debug-panel';

export default function GamePage() {
  const params = useParams();
  const router = useRouter();
  const roomId = params.roomId as string;
  const { socket, connected } = useSocket();

  const [board, setBoard] = useState<(string | null)[]>(Array(9).fill(null));
  const [currentTurn, setCurrentTurn] = useState<string>('X');
  const [myMark, setMyMark] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('waiting');
  const [winner, setWinner] = useState<string | null>(null);
  const [intensity, setIntensity] = useState(0);
  const [winningCells, setWinningCells] = useState<number[] | null>(null);
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Join or rejoin room on mount
  useEffect(() => {
    if (!socket || !connected) return;

    const isJoining = sessionStorage.getItem('joinRoomId');
    const token = sessionStorage.getItem('playerToken');
    const savedMark = sessionStorage.getItem('myMark');

    if (isJoining) {
      // Fresh join takes priority — clear any stale token from a previous game
      sessionStorage.removeItem('joinRoomId');
      sessionStorage.removeItem('playerToken');
      sessionStorage.removeItem('myMark');
      socket.emit('join-room', { roomId });
    } else if (token && savedMark) {
      // Reconnect with existing token (creator or page refresh)
      setMyMark(savedMark);
      socket.emit('rejoin-room', { roomId, playerToken: token });
    }
  }, [socket, connected, roomId]);

  // Register all socket event listeners
  useEffect(() => {
    if (!socket) return;

    socket.on('game-start', (data: {
      board: (string | null)[];
      currentTurn: string;
      intensity: number;
      playerToken?: string;
    }) => {
      setBoard(data.board);
      setCurrentTurn(data.currentTurn);
      setIntensity(data.intensity);
      setStatus('active');
      setWinner(null);
      setWinningCells(null);
      if (data.playerToken) {
        sessionStorage.setItem('playerToken', data.playerToken);
        setMyMark('O'); // joining player is always O
        sessionStorage.setItem('myMark', 'O');
      }
    });

    socket.on('move-made', (data: {
      board: (string | null)[];
      currentTurn: string;
      intensity: number;
    }) => {
      setBoard(data.board);
      setCurrentTurn(data.currentTurn);
      setIntensity(data.intensity);
    });

    // Async intensity upgrade from Gemini (arrives after move-made)
    socket.on('intensity-update', (data: {
      intensity: number;
      source: string;
      moveNumber: number;
    }) => {
      setIntensity(data.intensity);
    });

    socket.on('game-over', (data: {
      winner: string;
      winningCells?: number[];
      board: (string | null)[];
      finalIntensity: number;
    }) => {
      setBoard(data.board);
      setWinner(data.winner);
      setWinningCells(data.winningCells ?? null);
      setIntensity(data.finalIntensity);
      setStatus('finished');
    });

    socket.on('game-state', (data: {
      board: (string | null)[];
      currentTurn: string;
      mark: string;
      intensity: number;
      status: string;
    }) => {
      setBoard(data.board);
      setCurrentTurn(data.currentTurn);
      setMyMark(data.mark);
      setIntensity(data.intensity);
      setStatus(data.status);
      sessionStorage.setItem('myMark', data.mark);
    });

    socket.on('player-disconnected', () => {
      setOpponentDisconnected(true);
    });

    socket.on('player-reconnected', () => {
      setOpponentDisconnected(false);
    });

    socket.on('error', (data: { code: string; message: string }) => {
      if (data.code === 'INVALID_TOKEN' || data.code === 'ROOM_NOT_FOUND') {
        // Stale session — clear and redirect home
        sessionStorage.removeItem('playerToken');
        sessionStorage.removeItem('myMark');
        setError('Session expired. Redirecting...');
        setTimeout(() => router.push('/'), 1500);
        return;
      }
      setError(data.message);
      setTimeout(() => setError(null), 3000);
    });

    return () => {
      socket.off('game-start');
      socket.off('move-made');
      socket.off('intensity-update');
      socket.off('game-over');
      socket.off('game-state');
      socket.off('player-disconnected');
      socket.off('player-reconnected');
      socket.off('error');
    };
  }, [socket]);

  const handleCellClick = useCallback((cell: number) => {
    if (!socket || status !== 'active' || currentTurn !== myMark) return;
    socket.emit('make-move', { roomId, cell });
  }, [socket, status, currentTurn, myMark, roomId]);

  const handleRematch = useCallback(() => {
    if (!socket) return;
    socket.emit('rematch', { roomId });
  }, [socket, roomId]);

  const isMyTurn = status === 'active' && currentTurn === myMark;

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-6 p-4">
      <div className="absolute top-4 right-4">
        <ConnectionStatus connected={connected} />
      </div>

      <GameStatus
        roomId={roomId}
        myMark={myMark}
        currentTurn={currentTurn}
        status={status}
        winner={winner}
      />

      <GameBoard
        board={board}
        onCellClick={handleCellClick}
        winningCells={winningCells}
        disabled={!isMyTurn}
      />

      <IntensityMeter intensity={intensity} />

      {opponentDisconnected && (
        <div className="text-yellow-400 bg-yellow-900/30 px-4 py-2 rounded text-sm">
          Opponent disconnected. Waiting for reconnection...
        </div>
      )}

      {error && (
        <div className="text-red-400 bg-red-900/30 px-4 py-2 rounded text-sm">{error}</div>
      )}

      {status === 'finished' && (
        <button
          onClick={handleRematch}
          className="bg-purple-600 hover:bg-purple-700 px-6 py-2 rounded font-bold transition-colors"
        >
          Rematch
        </button>
      )}

      <EventDebugPanel socket={socket} />
    </main>
  );
}
