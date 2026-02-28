'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSocket } from '@/hooks/use-socket';
import ConnectionStatus from '@/components/connection-status';

export default function Home() {
  const router = useRouter();
  const { socket, connected } = useSocket();
  const [joinCode, setJoinCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [waiting, setWaiting] = useState(false);

  useEffect(() => {
    if (!socket) return;

    socket.on('room-created', (data: { roomId: string; mark: string; playerToken: string }) => {
      sessionStorage.setItem('playerToken', data.playerToken);
      sessionStorage.setItem('myMark', data.mark);
      router.push(`/game/${data.roomId}`);
    });

    socket.on('error', (data: { code: string; message: string }) => {
      setError(data.message);
      setWaiting(false);
    });

    return () => {
      socket.off('room-created');
      socket.off('error');
    };
  }, [socket, router]);

  const handleCreate = () => {
    if (!socket) return;
    setError(null);
    setWaiting(true);
    socket.emit('create-room', {});
  };

  const handleJoin = () => {
    if (!socket || !joinCode.trim()) return;
    setError(null);
    sessionStorage.setItem('joinRoomId', joinCode.trim());
    router.push(`/game/${joinCode.trim()}`);
  };

  return (
    <main className="min-h-screen bg-black text-white flex flex-col items-center justify-center gap-8 p-4">
      <div className="absolute top-4 right-4">
        <ConnectionStatus connected={connected} />
      </div>

      <h1 className="text-4xl font-bold">Tic-Tac-Toe</h1>
      <p className="text-gray-400">Multiplayer with AI Intensity</p>

      {error && (
        <div className="text-red-400 bg-red-900/30 px-4 py-2 rounded text-sm">{error}</div>
      )}

      <div className="flex flex-col gap-4 w-64">
        <button
          onClick={handleCreate}
          disabled={!connected || waiting}
          className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 px-6 py-3 rounded font-bold transition-colors"
        >
          {waiting ? 'Creating...' : 'Create Room'}
        </button>

        <div className="flex gap-2">
          <input
            type="text"
            value={joinCode}
            onChange={e => setJoinCode(e.target.value)}
            placeholder="Room code (6 chars)"
            maxLength={6}
            className="flex-1 bg-gray-900 border border-gray-700 px-3 py-2 rounded text-center font-mono"
          />
          <button
            onClick={handleJoin}
            disabled={!connected || !joinCode.trim()}
            className="bg-green-600 hover:bg-green-700 disabled:bg-gray-700 disabled:text-gray-500 px-4 py-2 rounded font-bold transition-colors"
          >
            Join
          </button>
        </div>

        <a
          href="/tictactoe/index.html"
          className="text-gray-500 hover:text-gray-300 text-sm text-center transition-colors"
        >
          Play solo (no server)
        </a>
      </div>
    </main>
  );
}
