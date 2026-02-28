'use client';

import { useEffect, useState, useRef } from 'react';
import type { NarrationEvent, NarrationTone } from '@/game/types';

const FADE_DURATION = 4000;

const toneTextColor: Record<NarrationTone, string> = {
  calm: 'text-gray-400',
  building: 'text-gray-300',
  tense: 'text-yellow-300',
  explosive: 'text-red-300',
};

const toneBorderClass: Record<NarrationTone, string> = {
  calm: 'border-transparent',
  building: 'border border-gray-700',
  tense: 'border border-yellow-700/50',
  explosive: 'border border-red-700/50 animate-pulse',
};

interface NarratorSubtitleProps {
  narration: NarrationEvent | null;
}

export default function NarratorSubtitle({ narration }: NarratorSubtitleProps) {
  const [visible, setVisible] = useState(false);
  const [displayedNarration, setDisplayedNarration] = useState<NarrationEvent | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!narration) {
      setVisible(false);
      return;
    }

    // Clear any existing fade-out timer
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }

    setDisplayedNarration(narration);
    setVisible(true);

    // Fade out after duration
    timerRef.current = setTimeout(() => {
      setVisible(false);
      timerRef.current = null;
    }, FADE_DURATION);

    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [narration]);

  if (!displayedNarration) return null;

  const tone = displayedNarration.tone;

  return (
    <div
      className={`
        w-full max-w-md mx-auto text-center px-4 py-2 rounded-lg
        font-mono text-sm
        transition-opacity duration-500 ease-in-out
        ${visible ? 'opacity-100' : 'opacity-0'}
        ${toneTextColor[tone]}
        ${toneBorderClass[tone]}
        bg-black/60
      `}
    >
      {displayedNarration.text}
    </div>
  );
}
