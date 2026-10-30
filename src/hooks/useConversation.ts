"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { analyseStream } from "@/lib/audio/analyser";
import { VoiceError, toVoiceError } from "@/lib/audio/errors";
import { releaseMic, requestMic } from "@/lib/audio/mic";
import { createAudioPlayer, type AudioPlayer } from "@/lib/audio/player";
import { startRecorder, type Recorder } from "@/lib/audio/recorder";
import type { LevelSource, Turn, VoiceState } from "@/lib/audio/types";
import type { Evidence, TimelineStep } from "@/lib/evidence";
import { createIssue, type IssueDraft } from "@/lib/issues";
import { isInterruption, streamReply } from "@/lib/reply";
import { createSpeechChunker } from "@/lib/speech/chunker";
import { createSpeaker, type Speaker } from "@/lib/speech/speaker";
import { createTurnTimer, type TurnTimer } from "@/lib/timing";
import { transcribeAudio } from "@/lib/transcribe";

export const MAX_RECORDING_MS = 60_000;
const MIN_RECORDING_MS = 300;
const MIN_BYTES = 1_000;
const MEMORY_TURNS = 6; // remember the last 3 question/answer pairs
const MAX_TURN_CHARS = 2_000; // what /api/reply accepts per remembered turn
const MAX_CARDS = 6;

type Action =
  | { type: "request" }
  | { type: "record"; startedAt: number }
  | { type: "transcribe"; autoStopped: boolean }
  | { type: "think"; autoStopped: boolean }
  | { type: "speak" }
  | { type: "done"; autoStopped: boolean }
  | { type: "stopped" }
  | { type: "fail"; error: VoiceError }
  | { type: "reset"; note?: string };

// The reducer only describes which state comes next. All side effects live below.
function reducer(_state: VoiceState, action: Action): VoiceState {
  switch (action.type) {
    case "request":
      return { status: "requesting" };
    case "record":
      return { status: "recording", startedAt: action.startedAt };
    case "transcribe":
      return { status: "transcribing", autoStopped: action.autoStopped };
    case "think":
      return { status: "thinking", autoStopped: action.autoStopped };
    case "speak":
      return { status: "speaking" };
    case "done":
      return { status: "done", autoStopped: action.autoStopped };
    case "stopped":
      return { status: "stopped" };
    case "fail":
      return { status: "error", error: action.error };
    case "reset":
      return { status: "idle", note: action.note };
  }
}

// Where the turn is right now. Kept in a ref (not state) so start/stop can check it
// instantly, even between renders. Presses are ignored while "transcribing"; while
// "answering" (thinking or speaking) a press interrupts Relay.
type Phase = "idle" | "starting" | "recording" | "transcribing" | "answering";

interface Session {
  stream: MediaStream;
  recorder: Recorder;
  levels: LevelSource;
  autoStopTimer: ReturnType<typeof setTimeout>;
}

/** What's needed to cut off the answer Relay is giving right now. */
interface Answering {
  /** Aborting it cancels /api/reply (and, on the server, the calls to Groq). */
  controller: AbortController;
  speaker: Speaker;
  /** When you let go, so "Interrupted" is timed like the other milestones. */
  releasedAt: number;
  /** null for a line Relay says on its own, like "Done, issue #13 is open". */
  question: string | null;
  /** The answer so far. */
  text: string;
}

/**
 * Which version of Relay this is. "demo": anyone, public repos, read-only, daily limits.
 * "full": the owner, after the password. The server enforces it; this is for display.
 */
export interface Access {
  mode: "demo" | "full";
  /** Whose GitHub this is, e.g. "Liciacodes". */
  owner: string | null;
  /** False when no password is set up, so there's nothing to unlock. */
  canUnlock: boolean;
}

/** The draft card's state. Nothing exists on GitHub until Confirm succeeds. */
export type DraftState = IssueDraft & { status: "ready" | "creating" | "failed"; error?: string };

/** The whole voice loop: listen → transcribe → think → speak, and interrupting it. */
export function useConversation() {
  const [state, dispatch] = useReducer(reducer, { status: "idle" });
  /** The latest transcript. Stays on screen while the next one is being made. */
  const [transcript, setTranscript] = useState<string | null>(null);
  /** Relay's answer, growing as it streams in. */
  const [reply, setReply] = useState<string | null>(null);
  /** Shown when the browser's voice had to stand in for Groq's. */
  const [voiceNote, setVoiceNote] = useState<string | null>(null);
  /** What Relay did this turn, with real measured times. */
  const [steps, setSteps] = useState<TimelineStep[]>([]);
  /** The GitHub items behind this answer (at most 6). */
  const [evidence, setEvidence] = useState<Evidence[]>([]);
  /** True when you cut the answer on screen off. */
  const [interrupted, setInterrupted] = useState(false);
  /** An issue Relay drafted, waiting for your Confirm or Cancel. */
  const [draft, setDraft] = useState<DraftState | null>(null);
  /** Public demo or full mode (null until the server has said). */
  const [access, setAccess] = useState<Access | null>(null);

  const phase = useRef<Phase>("idle");
  /**
   * Counts turns. A cancelled turn's code may still be running (awaiting a network reply);
   * it compares its number with this one and stays quiet if a newer turn has started.
   */
  const turn = useRef(0);
  const answering = useRef<Answering | null>(null);
  /** The press that started this recording also interrupted Relay. */
  const startedByInterrupt = useRef(false);
  const releasedWhileStarting = useRef(false);
  const session = useRef<Session | null>(null);
  const memory = useRef<Turn[]>([]);
  const player = useRef<AudioPlayer | null>(null);
  /** The same draft as the state, readable instantly (e.g. to ignore a double click). */
  const draftRef = useRef<DraftState | null>(null);
  /** Live mic levels for the waveform. Null when not recording. */
  const micLevelsRef = useRef<LevelSource | null>(null);
  /** Live levels of Relay's voice for the orb. Null when not speaking. */
  const voiceLevelsRef = useRef<LevelSource | null>(null);

  const updateDraft = useCallback((next: DraftState | null) => {
    draftRef.current = next;
    setDraft(next);
  }, []);

  const remember = useCallback((question: string, answer: string) => {
    memory.current = [
      ...memory.current,
      { role: "user" as const, content: question.slice(0, MAX_TURN_CHARS) },
      { role: "assistant" as const, content: answer.slice(0, MAX_TURN_CHARS) },
    ].slice(-MEMORY_TURNS);
  }, []);

  const teardown = useCallback(() => {
    const current = session.current;
    if (!current) return;
    clearTimeout(current.autoStopTimer);
    current.levels.close();
    releaseMic(current.stream);
    session.current = null;
    micLevelsRef.current = null;
  }, []);

  /**
   * Cut off the answer Relay is giving: stop the voice now, cancel the request, and mark
   * what's on screen as interrupted. Returns false if Relay wasn't answering.
   */
  const cutOff = useCallback((): boolean => {
    const current = answering.current;
    if (!current) return false;
    answering.current = null;
    turn.current++; // the cut-off turn's late updates are now ignored
    current.speaker.cancel();
    current.controller.abort();
    voiceLevelsRef.current = null;
    phase.current = "idle";

    if (current.question) {
      const ms = performance.now() - current.releasedAt;
      setSteps((steps) => [...steps, { kind: "milestone", label: "Interrupted", ms, ok: true }]);
      setInterrupted(true);
      if (current.text.trim()) remember(current.question, `${current.text.trim()} (interrupted)`);
    }
    return true;
  }, [remember]);

  /**
   * Get an answer for `question`, showing and speaking it as it streams in.
   * `releasedAt` is when you let go (performance.now()); milestones are timed from it.
   */
  const respond = useCallback(
    async (question: string, autoStopped: boolean, releasedAt: number, timer: TurnTimer) => {
      const myTurn = turn.current;
      const live = () => turn.current === myTurn; // false once you interrupt
      const milestone = (label: string): TimelineStep => ({
        kind: "milestone",
        label,
        ms: performance.now() - releasedAt,
        ok: true,
      });
      const addStep = (step: TimelineStep) => live() && setSteps((current) => [...current, step]);

      dispatch({ type: "think", autoStopped });
      setReply("");
      setVoiceNote(null);
      setSteps([milestone("Heard you")]); // the transcript just arrived
      setEvidence([]);
      setInterrupted(false);
      updateDraft(null);

      const speaker = createSpeaker(player.current!, {
        onFirstAudio: () => {
          timer.mark("first sound");
          addStep(milestone("Started speaking"));
          if (live()) dispatch({ type: "speak" });
        },
        onTiming: (event) => timer.mark(event === "speak-sent" ? "first speak sent" : "first audio back"),
        onFallback: (reason) =>
          live() &&
          setVoiceNote(
            reason.code === "rate-limited"
              ? "Groq's voice limit was reached, so your browser's voice is speaking for now."
              : `${reason.message} Your browser's voice is speaking for now.`,
          ),
      });
      const current: Answering = { controller: new AbortController(), speaker, releasedAt, question, text: "" };
      answering.current = current;
      phase.current = "answering";
      voiceLevelsRef.current = speaker.levels;
      const chunker = createSpeechChunker((chunk) => {
        timer.mark("first chunk ready");
        timer.note("first chunk chars", chunk.length);
        speaker.say(chunk);
      });

      let firstWord = true;
      const drafted: { draft: IssueDraft | null } = { draft: null };

      try {
        let answer: string;
        try {
          timer.mark("reply sent");
          answer = await streamReply(question, memory.current, {
            signal: current.controller.signal,
            onText: (piece) => {
              if (!live()) return;
              timer.mark("first text");
              if (firstWord) addStep(milestone("First word"));
              firstWord = false;
              current.text += piece;
              setReply((text) => (text ?? "") + piece); // show it…
              chunker.push(piece); // …and queue it for speaking
            },
            onStep: (step) => {
              timer.mark(step.label.startsWith("Listed") ? "repos listed" : "lookup done");
              addStep({ kind: "tool", ...step }); // live, while still thinking
            },
            onEvidence: (items) => live() && setEvidence(items),
            onDraft: (next) => {
              if (!live()) return;
              drafted.draft = next;
              updateDraft({ ...next, status: "ready" });
            },
          });
        } catch (error) {
          if (isInterruption(error)) return; // you cut it off; cutOff() already tidied up
          speaker.stopAll(); // don't keep talking over an error
          throw error;
        }

        timer.mark("answer complete");
        chunker.flush();
        speaker.end();
        // Remember the draft too, so "make the title shorter" can work next turn.
        const draftNote = drafted.draft;
        remember(
          question,
          draftNote
            ? `${answer}\n(Draft for ${draftNote.repo}: title "${draftNote.title}", body "${draftNote.body}")`
            : answer,
        );

        await speaker.finished;
        if (live()) dispatch({ type: "done", autoStopped });
      } finally {
        timer.report(question);
        if (answering.current === current) {
          answering.current = null;
          voiceLevelsRef.current = null;
        }
      }
    },
    [remember, updateDraft],
  );

  const finish = useCallback(
    async (autoStopped: boolean) => {
      const current = session.current;
      if (phase.current !== "recording" || !current) return;
      phase.current = "transcribing";
      const myTurn = turn.current;
      const releasedAt = performance.now(); // the timeline's "zero": when you let go
      const timer = createTurnTimer(releasedAt);

      const recording = await current.recorder.stop();
      timer.mark("recording saved");
      teardown();

      try {
        if (recording.durationMs < MIN_RECORDING_MS || recording.blob.size < MIN_BYTES) {
          // A quick tap that only interrupted Relay: that's "stop", not a failed question.
          if (startedByInterrupt.current) {
            dispatch({ type: "stopped" });
            return;
          }
          throw new VoiceError("empty-audio");
        }
        dispatch({ type: "transcribe", autoStopped });
        const text = await transcribeAudio(recording.blob);
        timer.mark("transcribed");
        if (!text.trim()) throw new VoiceError("empty-audio");
        setTranscript(text);
        await respond(text, autoStopped, releasedAt, timer);
      } catch (error) {
        if (turn.current === myTurn) dispatch({ type: "fail", error: toVoiceError(error) });
      } finally {
        if (turn.current === myTurn) phase.current = "idle";
      }
    },
    [teardown, respond],
  );

  const start = useCallback(async () => {
    // While Relay answers, a press interrupts it and starts listening.
    const interrupting = phase.current === "answering" && cutOff();
    if (phase.current !== "idle") return; // transcribing or recording: ignore
    turn.current++;
    phase.current = "starting";
    startedByInterrupt.current = interrupting;
    releasedWhileStarting.current = false;

    // This runs inside the key/pointer press, which is the "user gesture" browsers
    // require before any sound can play. Unlock the speaker now, for the reply later.
    player.current ??= createAudioPlayer();
    player.current.unlock();

    dispatch({ type: "request" });

    let stream: MediaStream;
    try {
      stream = await requestMic();
    } catch (error) {
      phase.current = "idle";
      dispatch({ type: "fail", error: toVoiceError(error) });
      return;
    }

    // The first time, the permission prompt appears and the person lets go to click
    // "Allow". Nothing was said yet, so we just get ready for the next hold.
    if (releasedWhileStarting.current) {
      releaseMic(stream);
      phase.current = "idle";
      dispatch(interrupting ? { type: "stopped" } : { type: "reset", note: "Microphone ready. Hold to talk." });
      return;
    }

    const levels = analyseStream(stream);
    session.current = {
      stream,
      levels,
      recorder: startRecorder(stream),
      autoStopTimer: setTimeout(() => void finish(true), MAX_RECORDING_MS),
    };
    micLevelsRef.current = levels;
    phase.current = "recording";
    dispatch({ type: "record", startedAt: Date.now() });
  }, [finish, cutOff]);

  const stop = useCallback(() => {
    if (phase.current === "starting") releasedWhileStarting.current = true;
    else if (phase.current === "recording") void finish(false);
    // "idle", "transcribing" or "answering": nothing to stop (e.g. letting go after the 60s auto-stop)
  }, [finish]);

  /** Escape: stop Relay talking or thinking, without listening. */
  const silence = useCallback(() => {
    if (cutOff()) dispatch({ type: "stopped" });
  }, [cutOff]);

  /** Say one short line out loud (no model call), e.g. after an issue was created. */
  const say = useCallback(async (line: string) => {
    if (phase.current !== "idle" || !player.current) return; // you're talking: stay quiet
    const myTurn = turn.current;
    const speaker = createSpeaker(player.current, {
      onFirstAudio: () => turn.current === myTurn && dispatch({ type: "speak" }),
      onFallback: () => {},
    });
    const current: Answering = {
      controller: new AbortController(),
      speaker,
      releasedAt: performance.now(),
      question: null,
      text: line,
    };
    answering.current = current;
    phase.current = "answering";
    voiceLevelsRef.current = speaker.levels;
    speaker.say(line);
    speaker.end();
    await speaker.finished.catch(() => {}); // it's on screen too; a voice failure is fine
    if (answering.current === current) {
      answering.current = null;
      voiceLevelsRef.current = null;
      phase.current = "idle";
      dispatch({ type: "done", autoStopped: false });
    }
  }, []);

  /**
   * Confirm: create the drafted issue on GitHub. The ONLY way Relay writes anything.
   * Returns true once the issue exists (the card then closes).
   */
  const confirmDraft = useCallback(async (): Promise<boolean> => {
    const current = draftRef.current;
    if (!current || current.status === "creating") return false; // a second click is ignored
    updateDraft({ ...current, status: "creating", error: undefined });
    try {
      const issue = await createIssue({ repo: current.repo, title: current.title, body: current.body });
      updateDraft(null);
      setEvidence((items) => [issue, ...items.filter((item) => item.url !== issue.url)].slice(0, MAX_CARDS));
      const name = issue.repo.split("/")[1] ?? issue.repo;
      const line = `Done, issue #${issue.number} is open in ${name}.`;
      setReply(line);
      setInterrupted(false);
      remember(`Confirm the draft issue "${current.title}".`, line);
      void say(line);
      return true;
    } catch (error) {
      updateDraft({ ...current, status: "failed", error: toVoiceError(error).message });
      return false;
    }
  }, [updateDraft, remember, say]);

  /** Cancel: just close the card. Nothing was ever sent to GitHub. */
  const cancelDraft = useCallback(() => {
    if (draftRef.current?.status !== "creating") updateDraft(null);
  }, [updateDraft]);

  // On page load, have the server fetch your repo list, so the first question already gets
  // the spelling hint ("reviewpal", not "ReviewPol"). The answer says which mode we're in.
  useEffect(() => {
    fetch("/api/warm", { method: "POST" })
      .then((response) => (response.ok ? (response.json() as Promise<Access>) : null))
      .then((value) => value && setAccess(value))
      .catch(() => {});
  }, []);

  // If the page goes away mid-turn, free the mic and go quiet.
  useEffect(() => {
    return () => {
      session.current?.recorder.cancel();
      teardown();
      answering.current?.controller.abort();
      player.current?.stopAll();
    };
  }, [teardown]);

  return {
    state,
    transcript,
    reply,
    voiceNote,
    steps,
    evidence,
    interrupted,
    draft,
    access,
    setAccess,
    start,
    stop,
    silence,
    confirmDraft,
    cancelDraft,
    micLevelsRef,
    voiceLevelsRef,
  };
}
