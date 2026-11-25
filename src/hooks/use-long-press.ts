"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";

export const HOLD_MS = 450;
export const MOVE_CANCEL_PX = 10;

export function useLongPress(onTrigger: () => void, onTap: () => void = onTrigger) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const suppressPointerClickRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const cancel = useCallback(() => {
    clear();
    startRef.current = null;
  }, [clear]);

  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (!event.isPrimary || event.button !== 0) return;
      clear();
      startRef.current = { x: event.clientX, y: event.clientY };
      suppressPointerClickRef.current = false;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        suppressPointerClickRef.current = true;
        globalThis.navigator?.vibrate?.(10);
        onTrigger();
      }, HOLD_MS);
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      const start = startRef.current;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_CANCEL_PX) {
        suppressPointerClickRef.current = true;
        cancel();
      }
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      if (!startRef.current || !event.isPrimary) return;
      event.stopPropagation();
      cancel();
    },
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClick(event: ReactMouseEvent<HTMLElement>) {
      event.stopPropagation();
      // Native click handles taps and keyboard activation once. A hold or
      // drag suppresses the trailing pointer click.
      if (event.detail > 0 && suppressPointerClickRef.current) return;
      onTap();
    },
    onContextMenu(event: ReactMouseEvent<HTMLElement>) {
      event.preventDefault();
    },
    style: { touchAction: "manipulation", userSelect: "none" } as const,
  };
}
