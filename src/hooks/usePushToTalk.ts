"use client";

import { useEffect, useEffectEvent, useRef } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

interface Options {
  onPress: () => void;
  onRelease: () => void;
  /** When false, presses are ignored (e.g. while transcribing). */
  enabled: boolean;
}

// Don't steal Space from people typing.
function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

/**
 * Hold-to-talk input: pointer on the button, Space anywhere, or Enter on the button.
 *
 * Space is handled in ONE place, the window listener. It calls preventDefault, and the
 * button has no onClick, so a focused button can't fire a second press of its own.
 */
export function usePushToTalk({ onPress, onRelease, enabled }: Options) {
  // Which input is holding right now, so one input can't release another's press.
  const heldBy = useRef<"pointer" | "space" | "enter" | null>(null);

  const press = (by: NonNullable<typeof heldBy.current>) => {
    if (heldBy.current || !enabled) return;
    heldBy.current = by;
    onPress();
  };

  const release = (by: typeof heldBy.current | "any") => {
    if (!heldBy.current || (by !== "any" && heldBy.current !== by)) return;
    heldBy.current = null;
    onRelease();
  };

  // useEffectEvent: the window listeners always see the latest press/release
  // without re-subscribing on every render.
  const onKeyDown = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.code !== "Space" || isTypingTarget(event.target)) return;
    event.preventDefault(); // no page scroll, no native button press
    if (!event.repeat) press("space"); // holding a key fires keydown again and again
  });
  const onKeyUp = useEffectEvent((event: globalThis.KeyboardEvent) => {
    if (event.code !== "Space" || heldBy.current !== "space") return;
    event.preventDefault();
    release("space");
  });
  // Switching tabs or windows mid-hold would swallow the key-up, so stop there.
  const onLostFocus = useEffectEvent(() => release("any"));

  useEffect(() => {
    const onVisibility = () => document.hidden && onLostFocus();
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onLostFocus);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onLostFocus);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);

  // Spread these onto the button.
  return {
    onPointerDown(event: PointerEvent<HTMLButtonElement>) {
      if (event.button !== 0) return; // left click / touch / pen only
      // Keep receiving pointerup even if the finger slides off the button.
      event.currentTarget.setPointerCapture(event.pointerId);
      press("pointer");
    },
    onPointerUp: () => release("pointer"),
    onPointerCancel: () => release("pointer"),
    onLostPointerCapture: () => release("pointer"),
    onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
      if (event.key !== "Enter") return;
      event.preventDefault();
      if (!event.repeat) press("enter");
    },
    onKeyUp(event: KeyboardEvent<HTMLButtonElement>) {
      if (event.key === "Enter") release("enter");
    },
    // A long press on phones opens a menu; this is a hold button, so block that.
    onContextMenu: (event: { preventDefault(): void }) => event.preventDefault(),
  };
}
