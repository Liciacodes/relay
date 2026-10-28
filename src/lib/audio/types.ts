import type { VoiceError } from "./errors";

// The voice capture state machine. Exactly one of these is true at a time.
// Day 2 adds "thinking" and "speaking" here.
export type VoiceState =
  | { status: "idle"; note?: string }
  | { status: "requesting" } // waiting for the mic permission prompt
  | { status: "recording"; startedAt: number }
  | { status: "transcribing"; autoStopped: boolean }
  | { status: "done"; text: string; autoStopped: boolean }
  | { status: "error"; error: VoiceError };

/** Anything that can report live audio levels: the mic today, Relay's voice on Day 2. */
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
