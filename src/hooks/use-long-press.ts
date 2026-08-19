"use client";

import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";

export const HOLD_MS = 450;
export const MOVE_CANCEL_PX = 10;

export function useLongPress(onTrigger: () => void) {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const heldRef = useRef(false);
  const suppressHeldClickRef = useRef(false);

  const clear = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  }, []);

  useEffect(() => clear, [clear]);

  const cancel = useCallback(() => {
    clear();
    startRef.current = null;
    heldRef.current = false;
  }, [clear]);

  return {
    onPointerDown(event: ReactPointerEvent<HTMLElement>) {
      if (!event.isPrimary || event.button !== 0) return;
      clear();
      startRef.current = { x: event.clientX, y: event.clientY };
      heldRef.current = false;
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        heldRef.current = true;
        globalThis.navigator?.vibrate?.(10);
        onTrigger();
      }, HOLD_MS);
    },
    onPointerMove(event: ReactPointerEvent<HTMLElement>) {
      const start = startRef.current;
      if (!start) return;
      if (Math.hypot(event.clientX - start.x, event.clientY - start.y) > MOVE_CANCEL_PX) cancel();
    },
    onPointerUp(event: ReactPointerEvent<HTMLElement>) {
      if (!startRef.current || !event.isPrimary) return;
      event.stopPropagation();
      const wasHeld = heldRef.current;
      clear();
      startRef.current = null;
      heldRef.current = false;
      if (!wasHeld) setTimeout(onTrigger, 0);
      suppressHeldClickRef.current = wasHeld;
    },
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onClick(event: ReactMouseEvent<HTMLElement>) {
      event.stopPropagation();
      // Also covers keyboard and accessibility-generated activation. A quick
      // pointer tap repeats the same idempotent state update; a completed hold is
      // explicitly suppressed so its trailing click is not treated as a tap.
      if (suppressHeldClickRef.current) suppressHeldClickRef.current = false;
      else setTimeout(onTrigger, 0);
    },
    onContextMenu(event: ReactMouseEvent<HTMLElement>) {
      event.preventDefault();
    },
    style: { touchAction: "manipulation", userSelect: "none" } as const,
  };
}
