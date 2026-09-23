'use client';

import { useCallback, useEffect, useState } from 'react';
import type { SourceId } from './types';
import { readSaved, writeSaved, STORAGE_KEYS } from './storage';

export const PRIORITY_PINS_EVENT = 'lifehub:priority-pins';

export function pinKey(source: SourceId, id: string): string {
  return `${source}:${id}`;
}

export function loadPriorityPins(): string[] {
  return readSaved<string[]>(STORAGE_KEYS.priorityPins, []);
}

export function savePriorityPins(pins: string[]) {
  writeSaved(STORAGE_KEYS.priorityPins, pins);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent(PRIORITY_PINS_EVENT, { detail: pins }));
  }
}

export function usePriorityPins() {
  const [pins, setPins] = useState<string[]>(() => loadPriorityPins());

  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<string[]>).detail;
      setPins(Array.isArray(detail) ? detail : loadPriorityPins());
    };
    window.addEventListener(PRIORITY_PINS_EVENT, onChange);
    return () => window.removeEventListener(PRIORITY_PINS_EVENT, onChange);
  }, []);

  const addPin = useCallback((source: SourceId, id: string) => {
    const key = pinKey(source, id);
    setPins(current => {
      if (current.includes(key)) return current;
      const next = [key, ...current];
      savePriorityPins(next);
      return next;
    });
  }, []);

  const removePin = useCallback((source: SourceId, id: string) => {
    const key = pinKey(source, id);
    setPins(current => {
      const next = current.filter(item => item !== key);
      savePriorityPins(next);
      return next;
    });
  }, []);

  const isPinned = useCallback(
    (source: SourceId, id: string) => pins.includes(pinKey(source, id)),
    [pins],
  );

  return { pins, addPin, removePin, isPinned };
}
