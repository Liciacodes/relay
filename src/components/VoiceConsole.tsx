"use client";

import { useId, useRef } from "react";
import { MAX_RECORDING_MS, useConversation } from "@/hooks/useConversation";
import { usePushToTalk } from "@/hooks/usePushToTalk";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { DraftCard } from "./DraftCard";
import { EvidenceList } from "./EvidenceList";
import { Orb, type OrbMode } from "./Orb";
import { OrbStage } from "./OrbStage";
import { Reply } from "./Reply";
import { StatusLine } from "./StatusLine";
import { TalkButton, type TalkMode } from "./TalkButton";
import { Timeline } from "./Timeline";
import { Transcript } from "./Transcript";
import { Waveform } from "./Waveform";

/** Wires the conversation hook to the screen. All audio logic lives in hooks/ and lib/. */
export function VoiceConsole() {
  const {
    state,
    transcript,
    reply,
    voiceNote,
    steps,
    evidence,
    interrupted,
    draft,
    start,
    stop,
    silence,
    confirmDraft,
    cancelDraft,
    micLevelsRef,
    voiceLevelsRef,
  } = useConversation();
  const reducedMotion = useReducedMotion();
  const hintId = useId();
  const talkButtonRef = useRef<HTMLButtonElement>(null);

  const { status } = state;
  const recording = status === "recording";
  const answering = status === "thinking" || status === "speaking";
  const stale = status === "transcribing"; // the last turn dims while the next is transcribed
  const cutOff = interrupted && !stale; // a cut-off answer is quieter (stale dims it further)

  const holdHandlers = usePushToTalk({
    onPress: () => void start(), // while Relay answers, this interrupts it
    onRelease: stop,
    onStop: silence, // Escape
    enabled: status !== "transcribing",
  });

  const talkMode: TalkMode =
    status === "requesting" ? "starting" : answering || recording || stale ? status : "ready";
  const orbMode: OrbMode = answering ? status : "idle";

  // When the card goes away (Cancel, or Confirm worked), put focus back where you talk from.
  // If Confirm failed, the card stays with its error and keeps focus.
  const onConfirm = async () => {
    if (await confirmDraft()) talkButtonRef.current?.focus();
  };
  const onCancel = () => {
    cancelDraft();
    talkButtonRef.current?.focus();
  };

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
          {/* One turn, in story order: your words, what Relay did, its answer, the proof. */}
          <Transcript text={transcript} stale={stale} />
          <Timeline steps={steps} stale={stale} interrupted={cutOff} />
          <Reply text={reply} streaming={answering} stale={stale} interrupted={cutOff} />
          {/* key: a new draft is a new card, so it gets focus again. */}
          {draft && (
            <DraftCard
              key={`${draft.repo} ${draft.title}`}
              draft={draft}
              onConfirm={() => void onConfirm()}
              onCancel={onCancel}
            />
          )}
          <EvidenceList items={evidence} stale={stale} interrupted={cutOff} />
        </div>
      </div>

      {/* Sticky, so the button stays on screen when cards make the page scroll.
          The ::before is a soft fade, so content slides under it instead of being cut. */}
      <div className="sticky bottom-0 flex w-full flex-col items-center gap-4 bg-ink pt-3 pb-[max(2rem,env(safe-area-inset-bottom))] before:pointer-events-none before:absolute before:inset-x-0 before:-top-8 before:h-8 before:bg-linear-to-t before:from-ink before:to-transparent">
        <StatusLine state={state} limitMs={MAX_RECORDING_MS} note={voiceNote} />
        <TalkButton ref={talkButtonRef} mode={talkMode} hintId={hintId} {...holdHandlers} />
        {/* Hidden on touch-only devices (no Space bar or Escape there). */}
        <p id={hintId} className="text-[13px] text-muted pointer-coarse:hidden">
          Or hold <kbd className="rounded border border-line px-1.5 py-px font-sans text-[12px] text-text">Space</kbd> anywhere
          {answering && (
            <>
              . <kbd className="rounded border border-line px-1.5 py-px font-sans text-[12px] text-text">Esc</kbd> stops
              Relay
            </>
          )}
        </p>
      </div>
    </div>
  );
}
