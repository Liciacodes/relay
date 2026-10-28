"use client";

import type { ComponentProps } from "react";

export type TalkMode = "ready" | "starting" | "recording" | "transcribing" | "thinking" | "speaking";

const LABELS: Record<TalkMode, string> = {
  ready: "Hold to talk",
  starting: "Opening mic…",
  recording: "Release to send",
  transcribing: "Transcribing…",
  thinking: "Thinking…",
  speaking: "Speaking…",
};

interface Props extends Omit<ComponentProps<"button">, "children"> {
  mode: TalkMode;
  hintId: string;
}

/**
 * The hold-to-talk button. It has no onClick on purpose: pressing comes from the
 * pointer/keyboard handlers passed in by usePushToTalk.
 */
export function TalkButton({ mode, hintId, ...handlers }: Props) {
  const busy = mode === "transcribing" || mode === "thinking" || mode === "speaking";
  return (
    <button
      type="button"
      {...handlers}
      aria-pressed={mode === "recording"}
      aria-disabled={busy}
      aria-describedby={hintId}
      data-mode={mode}
      className="talk-button group relative flex h-14 min-w-56 touch-none items-center justify-center gap-3 rounded-full border px-7 text-[15px] font-medium select-none"
    >
      <span aria-hidden="true" className="talk-dot size-2 rounded-full" />
      {LABELS[mode]}
    </button>
  );
}
