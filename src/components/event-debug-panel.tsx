'use client';

import { useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';

interface EventDebugPanelProps {
  socket: Socket | null;
}

interface LogEntry {
  id: number;
  time: string;
  event: string;
  data: string;
}

export default function EventDebugPanel({ socket }: EventDebugPanelProps) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const idRef = useRef(0);

  useEffect(() => {
    if (!socket) return;

    const handler = (event: string, ...args: unknown[]) => {
      const entry: LogEntry = {
        id: idRef.current++,
        time: new Date().toLocaleTimeString(),
        event,
        data: JSON.stringify(args[0] ?? {}, null, 0).slice(0, 200),
      };
      setLogs(prev => [entry, ...prev].slice(0, 50));
    };

    socket.onAny(handler);
    return () => { socket.offAny(handler); };
  }, [socket]);

  return (
    <div className="border border-gray-700 rounded mt-4">
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-1 text-xs text-left text-gray-400 hover:text-white"
      >
        {open ? '[-]' : '[+]'} Event Log ({logs.length})
      </button>
      {open && (
        <div className="max-h-48 overflow-y-auto p-2 text-xs font-mono space-y-1">
          {logs.map(log => (
            <div key={log.id} className="text-gray-500">
              <span className="text-gray-600">{log.time}</span>{' '}
              <span className="text-cyan-400">{log.event}</span>{' '}
              {log.data}
            </div>
          ))}
          {logs.length === 0 && <div className="text-gray-600">No events yet</div>}
        </div>
      )}
    </div>
  );
}
