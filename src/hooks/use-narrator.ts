'use client';

import { useRef, useCallback, useState, useEffect } from 'react';
import type { NarrationEvent, NarrationTone } from '@/game/types';

const TONE_RATES: Record<NarrationTone, number> = {
  calm: 0.9,
  building: 1.0,
  tense: 1.05,
  explosive: 1.1,
};

const TONE_PITCHES: Record<NarrationTone, number> = {
  calm: 1.0,
  building: 1.0,
  tense: 1.1,
  explosive: 1.2,
};

function getStoredBoolean(key: string, defaultValue: boolean): boolean {
  if (typeof window === 'undefined') return defaultValue;
  const stored = localStorage.getItem(key);
  if (stored === null) return defaultValue;
  return stored === 'true';
}

function selectVoice(): SpeechSynthesisVoice | null {
  if (typeof window === 'undefined') return null;
  const voices = speechSynthesis.getVoices();
  return (
    voices.find((v) => v.name.includes('Google US English')) ??
    voices.find((v) => v.lang.startsWith('en')) ??
    voices[0] ??
    null
  );
}

export interface NarratorOptions {
  enabled?: boolean;
  volume?: number;
  voice?: string;
}

export interface NarratorReturn {
  speak: (event: NarrationEvent) => void;
  cancel: () => void;
  speaking: boolean;
  enabled: boolean;
  toggleEnabled: () => void;
  muted: boolean;
  toggleMuted: () => void;
}

export function useNarrator(options: NarratorOptions = {}): NarratorReturn {
  const { volume = 0.8 } = options;

  const [enabled, setEnabled] = useState<boolean>(() =>
    getStoredBoolean('narrator-enabled', options.enabled ?? true),
  );
  const [muted, setMuted] = useState<boolean>(() =>
    getStoredBoolean('narrator-muted', false),
  );
  const [speaking, setSpeaking] = useState(false);

  const queueRef = useRef<NarrationEvent[]>([]);
  const speakingRef = useRef(false);
  const voiceRef = useRef<SpeechSynthesisVoice | null>(null);

  // Load voices (they may arrive asynchronously)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const loadVoices = () => {
      voiceRef.current = selectVoice();
    };

    loadVoices();
    speechSynthesis.addEventListener('voiceschanged', loadVoices);
    return () => {
      speechSynthesis.removeEventListener('voiceschanged', loadVoices);
    };
  }, []);

  // Persist enabled state
  useEffect(() => {
    localStorage.setItem('narrator-enabled', String(enabled));
  }, [enabled]);

  // Persist muted state
  useEffect(() => {
    localStorage.setItem('narrator-muted', String(muted));
  }, [muted]);

  const processQueue = useCallback(() => {
    if (speakingRef.current || queueRef.current.length === 0) return;
    if (typeof window === 'undefined') return;

    const event = queueRef.current.shift()!;
    speakingRef.current = true;
    setSpeaking(true);

    // When muted, skip TTS but still process queue timing
    if (muted) {
      speakingRef.current = false;
      setSpeaking(false);
      processQueue();
      return;
    }

    const utterance = new SpeechSynthesisUtterance(event.text);
    utterance.rate = TONE_RATES[event.tone];
    utterance.pitch = TONE_PITCHES[event.tone];
    utterance.volume = volume;

    if (voiceRef.current) {
      utterance.voice = voiceRef.current;
    }

    utterance.onend = () => {
      speakingRef.current = false;
      setSpeaking(false);
      processQueue();
    };

    utterance.onerror = () => {
      speakingRef.current = false;
      setSpeaking(false);
      processQueue();
    };

    speechSynthesis.speak(utterance);
  }, [muted, volume]);

  const speak = useCallback(
    (event: NarrationEvent) => {
      if (!enabled) return;

      // Drop stale narration (older moveNumber) but keep current or newer
      queueRef.current = queueRef.current.filter(
        (e) => e.moveNumber >= event.moveNumber,
      );

      queueRef.current.push(event);
      processQueue();
    },
    [enabled, processQueue],
  );

  const cancel = useCallback(() => {
    queueRef.current = [];
    if (typeof window !== 'undefined') {
      speechSynthesis.cancel();
    }
    speakingRef.current = false;
    setSpeaking(false);
  }, []);

  const toggleEnabled = useCallback(() => {
    setEnabled((prev) => {
      const next = !prev;
      if (!next) {
        // Disabling: cancel any in-progress speech
        queueRef.current = [];
        if (typeof window !== 'undefined') {
          speechSynthesis.cancel();
        }
        speakingRef.current = false;
        setSpeaking(false);
      }
      return next;
    });
  }, []);

  const toggleMuted = useCallback(() => {
    setMuted((prev) => {
      const next = !prev;
      if (next && typeof window !== 'undefined') {
        // Muting: cancel current speech but keep queue processing
        speechSynthesis.cancel();
        speakingRef.current = false;
        setSpeaking(false);
      }
      return next;
    });
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined') {
        speechSynthesis.cancel();
      }
    };
  }, []);

  return { speak, cancel, speaking, enabled, toggleEnabled, muted, toggleMuted };
}
