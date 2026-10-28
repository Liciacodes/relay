"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { analyseStream } from "@/lib/audio/analyser";
import { VoiceError, toVoiceError } from "@/lib/audio/errors";
import { releaseMic, requestMic } from "@/lib/audio/mic";
import { createAudioPlayer, type AudioPlayer } from "@/lib/audio/player";
import { startRecorder, type Recorder } from "@/lib/audio/recorder";
import type { LevelSource, Turn, VoiceState } from "@/lib/audio/types";
import { streamReply } from "@/lib/reply";
import { createSpeechChunker } from "@/lib/speech/chunker";
import { createSpeaker } from "@/lib/speech/speaker";
import { transcribeAudio } from "@/lib/transcribe";

export const MAX_RECORDING_MS = 60_000;
const MIN_RECORDING_MS = 300;
const MIN_BYTES = 1_000;
const MEMORY_TURNS = 6; // remember the last 3 question/answer pairs

type Action =
  | { type: "request" }
  | { type: "record"; startedAt: number }
  | { type: "transcribe"; autoStopped: boolean }
  | { type: "think"; autoStopped: boolean }
  | { type: "speak" }
  | { type: "done"; autoStopped: boolean }
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
    case "fail":
      return { status: "error", error: action.error };
    case "reset":
      return { status: "idle", note: action.note };
  }
}

// Where the turn is right now. Kept in a ref (not state) so start/stop can check it
// instantly, even between renders. "busy" covers transcribing, thinking and speaking:
// a new press is ignored until Relay has finished (interrupting comes on Day 5).
type Phase = "idle" | "starting" | "recording" | "busy";

interface Session {
  stream: MediaStream;
  recorder: Recorder;
  levels: LevelSource;
  autoStopTimer: ReturnType<typeof setTimeout>;
}

/** The whole voice loop: listen → transcribe → think → speak. */
export function useConversation() {
  const [state, dispatch] = useReducer(reducer, { status: "idle" });
  /** The latest transcript. Stays on screen while the next one is being made. */
  const [transcript, setTranscript] = useState<string | null>(null);
  /** Relay's answer, growing as it streams in. */
  const [reply, setReply] = useState<string | null>(null);
  /** Shown when the browser's voice had to stand in for Groq's. */
  const [voiceNote, setVoiceNote] = useState<string | null>(null);

  const phase = useRef<Phase>("idle");
  const releasedWhileStarting = useRef(false);
  const session = useRef<Session | null>(null);
  const memory = useRef<Turn[]>([]);
  const player = useRef<AudioPlayer | null>(null);
  /** Live mic levels for the waveform. Null when not recording. */
  const micLevelsRef = useRef<LevelSource | null>(null);
  /** Live levels of Relay's voice for the orb. Null when not speaking. */
  const voiceLevelsRef = useRef<LevelSource | null>(null);

  const teardown = useCallback(() => {
    const current = session.current;
    if (!current) return;
    clearTimeout(current.autoStopTimer);
    current.levels.close();
    releaseMic(current.stream);
    session.current = null;
    micLevelsRef.current = null;
  }, []);

  /** Get an answer for `question`, showing and speaking it as it streams in. */
  const respond = useCallback(async (question: string, autoStopped: boolean) => {
    dispatch({ type: "think", autoStopped });
    setReply("");
    setVoiceNote(null);

    const speaker = createSpeaker(player.current!, {
      onFirstAudio: () => dispatch({ type: "speak" }),
      onFallback: (reason) =>
        setVoiceNote(
          reason.code === "rate-limited"
            ? "Groq's voice limit was reached, so your browser's voice is speaking for now."
            : `${reason.message} Your browser's voice is speaking for now.`,
        ),
    });
    voiceLevelsRef.current = speaker.levels;
    const chunker = createSpeechChunker((chunk) => speaker.say(chunk));

    try {
      let answer: string;
      try {
        answer = await streamReply(question, memory.current, (piece) => {
          setReply((current) => (current ?? "") + piece); // show it…
          chunker.push(piece); // …and queue it for speaking
        });
      } catch (error) {
        speaker.stopAll(); // don't keep talking over an error
        throw error;
      }

      chunker.flush();
      speaker.end();
      memory.current = [
        ...memory.current,
        { role: "user" as const, content: question },
        { role: "assistant" as const, content: answer },
      ].slice(-MEMORY_TURNS);

      await speaker.finished;
      dispatch({ type: "done", autoStopped });
    } finally {
      voiceLevelsRef.current = null;
    }
  }, []);

  const finish = useCallback(
    async (autoStopped: boolean) => {
      const current = session.current;
      if (phase.current !== "recording" || !current) return;
      phase.current = "busy";

      const recording = await current.recorder.stop();
      teardown();

      try {
        if (recording.durationMs < MIN_RECORDING_MS || recording.blob.size < MIN_BYTES) {
          throw new VoiceError("empty-audio");
        }
        dispatch({ type: "transcribe", autoStopped });
        const text = await transcribeAudio(recording.blob);
        if (!text.trim()) throw new VoiceError("empty-audio");
        setTranscript(text);
        await respond(text, autoStopped);
      } catch (error) {
        dispatch({ type: "fail", error: toVoiceError(error) });
      } finally {
        phase.current = "idle";
      }
    },
    [teardown, respond],
  );

  const start = useCallback(async () => {
    if (phase.current !== "idle") return; // busy: ignore repeats and presses mid-reply
    phase.current = "starting";
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
      dispatch({ type: "reset", note: "Microphone ready. Hold to talk." });
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
  }, [finish]);

  const stop = useCallback(() => {
    if (phase.current === "starting") releasedWhileStarting.current = true;
    else if (phase.current === "recording") void finish(false);
    // "idle" or "busy": nothing to stop (e.g. letting go after the 60s auto-stop)
  }, [finish]);

  // If the page goes away mid-turn, free the mic and go quiet.
  useEffect(() => {
    return () => {
      session.current?.recorder.cancel();
      teardown();
      player.current?.stopAll();
    };
  }, [teardown]);

  return { state, transcript, reply, voiceNote, start, stop, micLevelsRef, voiceLevelsRef };
}
