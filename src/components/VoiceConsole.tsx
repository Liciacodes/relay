"use client";

import { useId } from "react";
import { MAX_RECORDING_MS, useConversation } from "@/hooks/useConversation";
import { usePushToTalk } from "@/hooks/usePushToTalk";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { Orb, type OrbMode } from "./Orb";
import { OrbStage } from "./OrbStage";
import { Reply } from "./Reply";
import { StatusLine } from "./StatusLine";
import { TalkButton, type TalkMode } from "./TalkButton";
import { Transcript } from "./Transcript";
import { Waveform } from "./Waveform";

/** Wires the conversation hook to the screen. All audio logic lives in hooks/ and lib/. */
export function VoiceConsole() {
  const { state, transcript, reply, voiceNote, start, stop, micLevelsRef, voiceLevelsRef } =
    useConversation();
  const reducedMotion = useReducedMotion();
  const hintId = useId();

  const { status } = state;
  const recording = status === "recording";
  const busy = status === "transcribing" || status === "thinking" || status === "speaking";

  const holdHandlers = usePushToTalk({
    onPress: () => void start(),
    onRelease: stop,
    enabled: !busy, // no interrupting Relay yet (Day 5)
  });

  const talkMode: TalkMode =
    status === "requesting" ? "starting" : busy || recording ? status : "ready";
  const orbMode: OrbMode = status === "thinking" || status === "speaking" ? status : "idle";

  return (
    <div className="flex w-full flex-1 flex-col items-center">
      <div className="flex flex-1 flex-col items-center justify-center gap-[clamp(1rem,4dvh,2rem)] py-4">
        <OrbStage
          live={recording}
          orb={<Orb levelsRef={voiceLevelsRef} mode={orbMode} reducedMotion={reducedMotion} />}
        >
          <Waveform levelsRef={micLevelsRef} active={recording} reducedMotion={reducedMotion} />
        </OrbStage>
        <div className="flex w-full flex-col items-center gap-3">
          <Transcript text={transcript} stale={status === "transcribing"} />
          <Reply
            text={reply}
            streaming={status === "thinking" || status === "speaking"}
            stale={status === "transcribing"}
          />
        </div>
      </div>

      <div className="flex flex-col items-center gap-4 pb-[max(2rem,env(safe-area-inset-bottom))]">
        <StatusLine state={state} limitMs={MAX_RECORDING_MS} note={voiceNote} />
        <TalkButton mode={talkMode} hintId={hintId} {...holdHandlers} />
        {/* Hidden on touch-only devices (no Space bar there). */}
        <p id={hintId} className="text-[13px] text-muted pointer-coarse:hidden">
          Or hold <kbd className="rounded border border-line px-1.5 py-px font-sans text-[12px] text-text">Space</kbd> anywhere
        </p>
      </div>
    </div>
  );
}
