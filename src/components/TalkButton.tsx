"use client";

import type { ComponentProps } from "react";

type Mode = "ready" | "starting" | "recording" | "busy";

const LABELS: Record<Mode, string> = {
  ready: "Hold to talk",
  starting: "Opening mic…",
  recording: "Release to send",
  busy: "Transcribing…",
};

interface Props extends Omit<ComponentProps<"button">, "children"> {
  mode: Mode;
  hintId: string;
}

/**
 * The hold-to-talk button. It has no onClick on purpose: pressing comes from the
 * pointer/keyboard handlers passed in by usePushToTalk.
 */
export function TalkButton({ mode, hintId, ...handlers }: Props) {
  const recording = mode === "recording";
  return (
    <button
      type="button"
      {...handlers}
      aria-pressed={recording}
      aria-disabled={mode === "busy"}
      aria-describedby={hintId}
      data-mode={mode}
      className="talk-button group relative flex h-14 min-w-56 touch-none items-center justify-center gap-3 rounded-full border px-7 text-[15px] font-medium select-none"
    >
      <span aria-hidden="true" className="talk-dot size-2 rounded-full" />
      {LABELS[mode]}
    </button>
  );
}
