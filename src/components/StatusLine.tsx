"use client";

import { useEffect, useState } from "react";
import type { VoiceState } from "@/lib/audio/types";

function formatSeconds(ms: number) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Ticks a few times a second while recording. Lives in its own component so only it re-renders. */
function Elapsed({ startedAt, limitMs }: { startedAt: number; limitMs: number }) {
  const [now, setNow] = useState(startedAt);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, []);
  const elapsed = Math.min(now - startedAt, limitMs);
  return (
    // aria-hidden: a screen reader announcing every second would be noise.
    <span aria-hidden="true" className="text-muted tabular-nums">
      {formatSeconds(elapsed)} of {formatSeconds(limitMs)}
    </span>
  );
}

function message(state: VoiceState): string {
  switch (state.status) {
    case "idle":
      return state.note ?? "Hold the button or the Space bar, speak, then let go.";
    case "requesting":
      return "Waiting for microphone access.";
    case "recording":
      return "Listening.";
    case "transcribing":
      return state.autoStopped ? "Stopped at 60 seconds. Transcribing." : "Transcribing.";
    case "thinking":
      return state.autoStopped ? "Stopped at 60 seconds. Thinking." : "Thinking.";
    case "speaking":
      return "Speaking.";
    case "done":
      return state.autoStopped ? "Stopped at 60 seconds." : "";
    case "error":
      return state.error.message;
  }
}

/**
 * One line that always says what's happening. role="status" makes screen readers
 * announce changes politely, without interrupting.
 */
export function StatusLine({
  state,
  limitMs,
  note,
}: {
  state: VoiceState;
  limitMs: number;
  /** A secondary line, e.g. "Using your browser's voice for now." */
  note?: string | null;
}) {
  const isError = state.status === "error";
  return (
    <p
      role="status"
      aria-live="polite"
      data-tone={isError ? "error" : "calm"}
      className="flex min-h-6 max-w-136 flex-wrap items-baseline justify-center gap-x-3 gap-y-1 text-center text-sm text-muted data-[tone=error]:text-ember"
    >
      <span>{message(state)}</span>
      {state.status === "recording" && <Elapsed startedAt={state.startedAt} limitMs={limitMs} />}
      {note && <span className="basis-full text-xs text-muted">{note}</span>}
    </p>
  );
}
