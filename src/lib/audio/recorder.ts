import type { Recording } from "./types";

// Browsers support different formats: Chrome/Firefox record webm, Safari records mp4.
// Groq's Whisper accepts both, so we take the first one this browser can do.
const PREFERRED_TYPES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

function pickMimeType(): string | undefined {
  return PREFERRED_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

export interface Recorder {
  /** Stop recording and get the finished audio. */
  stop(): Promise<Recording>;
  /** Stop and throw the audio away (used when the page unmounts mid-recording). */
  cancel(): void;
}

/** Start recording a mic stream right away. */
export function startRecorder(stream: MediaStream): Recorder {
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  const startedAt = performance.now();

  recorder.addEventListener("dataavailable", (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  });

  // Ask for a chunk every 250ms, so a cut-off recording still keeps most of its audio.
  recorder.start(250);

  return {
    stop() {
      return new Promise((resolve) => {
        const finish = () =>
          resolve({
            blob: new Blob(chunks, { type: recorder.mimeType || mimeType || "audio/webm" }),
            durationMs: performance.now() - startedAt,
          });

        if (recorder.state === "inactive") return finish();
        // "stop" fires after the last dataavailable, so every chunk is in by then.
        recorder.addEventListener("stop", finish, { once: true });
        recorder.stop();
      });
    },
    cancel() {
      if (recorder.state !== "inactive") recorder.stop();
      chunks.length = 0;
    },
  };
}
