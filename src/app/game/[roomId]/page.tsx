'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useSocket } from '@/hooks/use-socket';
import GameBoard from '@/components/game-board';
import GameStatus from '@/components/game-status';
import IntensityMeter from '@/components/intensity-meter';
import MoraleIndicator from '@/components/morale-indicator';
import ConnectionStatus from '@/components/connection-status';
import EventDebugPanel from '@/components/event-debug-panel';
import CrowdEmojis from '@/components/crowd-emojis';
import SeriesScoreboard from '@/components/series-scoreboard';
import RoundResultOverlay from '@/components/round-result-overlay';
import SeriesResult from '@/components/series-result';

interface SeriesLocal {
  currentRound: number;
  maxRounds: number;
  wins: { X: number; O: number };
  seriesOver: boolean;
  roundResults: Array<{ round: number; winner: string; moves: number }>;
}

interface SeriesOverData {
  seriesWinner: string | null;
  finalScore: { X: number; O: number };
  rounds: Array<{ round: number; winner: string; moves: number }>;
  totalMoves: number;
  peakIntensity: number;
  peakMorale?: { X: number; O: number };
  finalMorale?: { X: number; O: number };
}

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
  const [morale, setMorale] = useState<{ X: number; O: number }>({ X: 0, O: 0 });
  const [opponentDisconnected, setOpponentDisconnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Series state
  const [series, setSeries] = useState<SeriesLocal>({
    currentRound: 1,
    maxRounds: 5,
    wins: { X: 0, O: 0 },
    seriesOver: false,
    roundResults: [],
  });
  const [roundResult, setRoundResult] = useState<{ winner: string; round: number } | null>(null);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [seriesResult, setSeriesResult] = useState<SeriesOverData | null>(null);
  const peakIntensityRef = useRef(0);

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
      series?: SeriesLocal;
    }) => {
      setBoard(data.board);
      setCurrentTurn(data.currentTurn);
      setIntensity(data.intensity);
      setMorale({ X: 0, O: 0 });
      setStatus('active');
      setWinner(null);
      setWinningCells(null);
      if (data.series) setSeries(data.series);
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
      morale?: { X: number; O: number };
    }) => {
      setBoard(data.board);
      setCurrentTurn(data.currentTurn);
      setIntensity(data.intensity);
      if (data.morale) setMorale(data.morale);
    });

    // Async intensity upgrade from Gemini (arrives after move-made)
    socket.on('intensity-update', (data: {
      intensity: number;
      source: string;
      moveNumber: number;
      morale?: { X: number; O: number };
    }) => {
      setIntensity(data.intensity);
      if (data.intensity > peakIntensityRef.current) {
        peakIntensityRef.current = data.intensity;
      }
      if (data.morale) setMorale(data.morale);
    });

    socket.on('round-over', (data: {
      round: number;
      winner: string;
      winningCells?: number[];
      board: (string | null)[];
      finalIntensity: number;
      finalMorale?: { X: number; O: number };
      series: SeriesLocal;
      nextRoundIn: number | null;
    }) => {
      setBoard(data.board);
      setWinner(data.winner);
      setWinningCells(data.winningCells ?? null);
      setIntensity(data.finalIntensity);
      if (data.finalIntensity > peakIntensityRef.current) {
        peakIntensityRef.current = data.finalIntensity;
      }
      if (data.finalMorale) setMorale(data.finalMorale);
      setStatus('round-over');
      setSeries(data.series);
      setRoundResult({ winner: data.winner, round: data.round });

      // Countdown timer
      if (data.nextRoundIn) {
        let remaining = Math.ceil(data.nextRoundIn / 1000);
        setCountdown(remaining);
        const interval = setInterval(() => {
          remaining--;
          setCountdown(remaining > 0 ? remaining : null);
          if (remaining <= 0) clearInterval(interval);
        }, 1000);
      } else {
        setCountdown(null);
      }
    });

    socket.on('round-start', (data: {
      round: number;
      board: (string | null)[];
      currentTurn: string;
      series: SeriesLocal;
      intensity: number;
      morale?: { X: number; O: number };
    }) => {
      setBoard(data.board);
      setCurrentTurn(data.currentTurn);
      setIntensity(data.intensity);
      if (data.morale) setMorale(data.morale);
      setSeries(data.series);
      setStatus('active');
      setWinner(null);
      setWinningCells(null);
      setRoundResult(null);
      setCountdown(null);
    });

    socket.on('series-over', (data: SeriesOverData) => {
      setStatus('finished');
      setSeries(prev => ({ ...prev, seriesOver: true }));
      setSeriesResult(data);
    });

    socket.on('game-state', (data: {
      board: (string | null)[];
      currentTurn: string;
      mark: string;
      intensity: number;
      morale?: { X: number; O: number };
      status: string;
      series?: SeriesLocal;
    }) => {
      setBoard(data.board);
      setCurrentTurn(data.currentTurn);
      setMyMark(data.mark);
      setIntensity(data.intensity);
      if (data.morale) setMorale(data.morale);
      setStatus(data.status);
      sessionStorage.setItem('myMark', data.mark);
      if (data.series) setSeries(data.series);
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
      socket.off('round-over');
      socket.off('round-start');
      socket.off('series-over');
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

  const handleNewSeries = useCallback(() => {
    if (!socket) return;
    socket.emit('new-series', { roomId });
    // Reset local series state for immediate feedback
    setSeriesResult(null);
    setRoundResult(null);
    peakIntensityRef.current = 0;
  }, [socket, roomId]);

  const handleBackToHome = useCallback(() => {
    sessionStorage.removeItem('playerToken');
    sessionStorage.removeItem('myMark');
    sessionStorage.removeItem('joinRoomId');
    router.push('/');
  }, [router]);

  const isMyTurn = status === 'active' && currentTurn === myMark;

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-6 p-4">
      <div className="absolute top-4 right-4 flex items-center gap-3">
        <ConnectionStatus connected={connected} />
        <button
          type="button"
          onClick={handleBackToHome}
          className="text-gray-400 hover:text-white text-sm underline transition-colors"
        >
          Back to home
        </button>
      </div>

      <SeriesScoreboard series={series} morale={morale} />

      <GameStatus
        roomId={roomId}
        myMark={myMark}
        currentTurn={currentTurn}
        status={status}
        winner={winner}
      />

      <div className="flex items-center gap-2 sm:gap-4">
        {/* Left stand – Team Blue */}
        <div className="flex flex-row items-center gap-2 py-4 px-2 sm:px-3 bg-gray-900/80 rounded-xl border border-gray-700 min-h-[20rem] justify-center">
          <span
            className="text-blue-400 font-bold text-base sm:text-lg shrink-0"
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
          >
            Team Blue
          </span>
          <CrowdEmojis intensity={intensity} variant="blue" slots={10} />
        </div>

        <GameBoard
          board={board}
          onCellClick={handleCellClick}
          winningCells={winningCells}
          disabled={!isMyTurn}
        />

        {/* Right stand – Team Red */}
        <div className="flex flex-row items-center gap-2 py-4 px-2 sm:px-3 bg-gray-900/80 rounded-xl border border-gray-700 min-h-[20rem] justify-center">
          <span
            className="text-red-400 font-bold text-base sm:text-lg shrink-0"
            style={{ writingMode: 'vertical-rl', textOrientation: 'mixed', transform: 'rotate(180deg)' }}
          >
            Team Red
          </span>
          <CrowdEmojis intensity={intensity} variant="red" slots={10} />
        </div>
      </div>

      <IntensityMeter intensity={intensity} />
      <MoraleIndicator morale={morale} myMark={myMark} />

      {opponentDisconnected && (
        <div className="text-yellow-400 bg-yellow-900/30 px-4 py-2 rounded text-sm">
          Opponent disconnected. Waiting for reconnection...
        </div>
      )}

      {error && (
        <div className="text-red-400 bg-red-900/30 px-4 py-2 rounded text-sm">{error}</div>
      )}

      {roundResult && !seriesResult && (
        <RoundResultOverlay
          winner={roundResult.winner}
          round={roundResult.round}
          series={series}
          countdown={countdown}
          morale={morale}
        />
      )}

      {seriesResult && (
        <SeriesResult
          seriesWinner={seriesResult.seriesWinner}
          finalScore={seriesResult.finalScore}
          rounds={seriesResult.rounds}
          totalMoves={seriesResult.totalMoves}
          peakIntensity={seriesResult.peakIntensity}
          peakMorale={seriesResult.peakMorale}
          finalMorale={seriesResult.finalMorale}
          onNewSeries={handleNewSeries}
        />
      )}

      <EventDebugPanel socket={socket} />
    </main>
  );
}
