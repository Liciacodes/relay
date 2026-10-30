import type { VoiceError } from "./errors";

// The conversation state machine. Exactly one of these is true at a time.
// `autoStopped` remembers that recording hit the 60-second limit.
export type VoiceState =
  | { status: "idle"; note?: string }
  | { status: "requesting" } // waiting for the mic permission prompt
  | { status: "recording"; startedAt: number }
  | { status: "transcribing"; autoStopped: boolean }
  | { status: "thinking"; autoStopped: boolean } // reply requested, no voice yet
  | { status: "speaking" } // Relay's voice is playing
  | { status: "done"; autoStopped: boolean }
  | { status: "stopped" } // you stopped Relay mid-answer (Escape, or a quick tap)
  | { status: "error"; error: VoiceError };

/** Anything that can report live audio levels: the mic, or Relay's voice. */
export interface LevelSource {
  /** Number of samples readWaveform fills. */
  readonly size: number;
  /** Fill `target` with the latest waveform samples, each between -1 and 1. */
  readWaveform(target: Float32Array<ArrayBuffer>): void;
  /** Stop analysing and free the audio graph. */
  close(): void;
}

/** A finished recording, ready to send. */
export interface Recording {
  blob: Blob;
  durationMs: number;
}

/** One message in the short conversation memory sent with each question. */
export interface Turn {
  role: "user" | "assistant";
  content: string;
}
