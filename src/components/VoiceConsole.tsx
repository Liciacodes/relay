"use client";

import { useId } from "react";
import { MAX_RECORDING_MS, useVoiceCapture } from "@/hooks/useVoiceCapture";
import { usePushToTalk } from "@/hooks/usePushToTalk";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { OrbStage } from "./OrbStage";
import { StatusLine } from "./StatusLine";
import { TalkButton } from "./TalkButton";
import { Transcript } from "./Transcript";
import { Waveform } from "./Waveform";

/** Wires the voice hooks to the screen. All the audio logic lives in the hooks and lib/audio. */
export function VoiceConsole() {
  const { state, transcript, start, stop, levelsRef } = useVoiceCapture();
  const reducedMotion = useReducedMotion();
  const hintId = useId();

  const recording = state.status === "recording";
  const transcribing = state.status === "transcribing";

  const holdHandlers = usePushToTalk({
    onPress: () => void start(),
    onRelease: stop,
    enabled: !transcribing,
  });

  const mode = recording
    ? "recording"
    : state.status === "requesting"
      ? "starting"
      : transcribing
        ? "busy"
        : "ready";

  return (
    <div className="flex w-full flex-1 flex-col items-center">
      <div className="flex flex-1 flex-col items-center justify-center gap-[clamp(1.5rem,5dvh,2.5rem)] py-4">
        <OrbStage live={recording}>
          <Waveform levelsRef={levelsRef} active={recording} reducedMotion={reducedMotion} />
        </OrbStage>
        <Transcript text={transcript} stale={transcribing} />
      </div>

      <div className="flex flex-col items-center gap-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <StatusLine state={state} limitMs={MAX_RECORDING_MS} />
        <TalkButton mode={mode} hintId={hintId} {...holdHandlers} />
        {/* Hidden on touch-only devices (no Space bar there). */}
        <p id={hintId} className="text-[13px] text-muted pointer-coarse:hidden">
          Or hold <kbd className="rounded border border-line px-1.5 py-px font-sans text-[12px] text-text">Space</kbd> anywhere
        </p>
      </div>
    </div>
  );
}
