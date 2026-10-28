"use client";

import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import { analyseStream } from "@/lib/audio/analyser";
import { VoiceError, toVoiceError } from "@/lib/audio/errors";
import { releaseMic, requestMic } from "@/lib/audio/mic";
import { startRecorder, type Recorder } from "@/lib/audio/recorder";
import type { LevelSource, VoiceState } from "@/lib/audio/types";
import { transcribeAudio } from "@/lib/transcribe";

export const MAX_RECORDING_MS = 60_000;
const MIN_RECORDING_MS = 300;
const MIN_BYTES = 1_000;

type Action =
  | { type: "request" }
  | { type: "record"; startedAt: number }
  | { type: "transcribe"; autoStopped: boolean }
  | { type: "done"; text: string; autoStopped: boolean }
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
    case "done":
      return { status: "done", text: action.text, autoStopped: action.autoStopped };
    case "fail":
      return { status: "error", error: action.error };
    case "reset":
      return { status: "idle", note: action.note };
  }
}

// Where the capture is right now. Kept in a ref (not state) so start/stop can check it
// instantly, even between renders. This guard is what makes a double start harmless.
type Phase = "idle" | "starting" | "recording" | "finishing";

interface Session {
  stream: MediaStream;
  recorder: Recorder;
  levels: LevelSource;
  autoStopTimer: ReturnType<typeof setTimeout>;
}

export function useVoiceCapture() {
  const [state, dispatch] = useReducer(reducer, { status: "idle" });
  /** The latest transcript. Stays on screen while the next one is being made. */
  const [transcript, setTranscript] = useState<string | null>(null);
  const phase = useRef<Phase>("idle");
  const releasedWhileStarting = useRef(false);
  const session = useRef<Session | null>(null);
  /** Live audio levels for the waveform. Null when not recording. */
  const levelsRef = useRef<LevelSource | null>(null);

  const teardown = useCallback(() => {
    const current = session.current;
    if (!current) return;
    clearTimeout(current.autoStopTimer);
    current.levels.close();
    releaseMic(current.stream);
    session.current = null;
    levelsRef.current = null;
  }, []);

  const finish = useCallback(
    async (autoStopped: boolean) => {
      const current = session.current;
      if (phase.current !== "recording" || !current) return;
      phase.current = "finishing";

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
        dispatch({ type: "done", text, autoStopped });
      } catch (error) {
        dispatch({ type: "fail", error: toVoiceError(error) });
      } finally {
        phase.current = "idle";
      }
    },
    [teardown],
  );

  const start = useCallback(async () => {
    if (phase.current !== "idle") return; // already busy: ignore repeats
    phase.current = "starting";
    releasedWhileStarting.current = false;
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
    levelsRef.current = levels;
    phase.current = "recording";
    dispatch({ type: "record", startedAt: Date.now() });
  }, [finish]);

  const stop = useCallback(() => {
    if (phase.current === "starting") releasedWhileStarting.current = true;
    else if (phase.current === "recording") void finish(false);
    // "idle" or "finishing": nothing to stop (e.g. letting go after the 60s auto-stop)
  }, [finish]);

  // If the page goes away mid-recording, free the mic and throw the audio away.
  useEffect(() => {
    return () => {
      session.current?.recorder.cancel();
      teardown();
    };
  }, [teardown]);

  return { state, transcript, start, stop, levelsRef };
}
