'use client';

import { SocketProvider } from '@/hooks/use-socket';
import type { ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
  return <SocketProvider>{children}</SocketProvider>;
}
