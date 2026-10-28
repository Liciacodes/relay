// Every way voice capture can fail, as a small fixed list of codes.
// The UI switches on the code; the message is what the person reads.

export type VoiceErrorCode =
  | "permission-denied" // the person (or browser policy) blocked the mic
  | "no-mic" // no input device is connected
  | "mic-busy" // another app holds the mic exclusively
  | "unsupported" // browser can't record, or the page isn't on https/localhost
  | "network" // the request to our server never got an answer
  | "empty-audio" // too short, silent, or nothing was transcribed
  | "server"; // our server or Groq returned an error

const MESSAGES: Record<VoiceErrorCode, string> = {
  "permission-denied":
    "Microphone access is blocked. Allow it in your browser's site settings, then try again.",
  "no-mic": "No microphone found. Connect one and try again.",
  "mic-busy":
    "Another app is using your microphone. Close it and try again.",
  unsupported:
    "This browser can't record audio here. Use a recent browser, on localhost or https.",
  network: "Couldn't reach the server. Check your connection and try again.",
  "empty-audio":
    "Nothing to transcribe. Keep holding while you speak, then let go.",
  server: "Transcription failed. Try again in a moment.",
};

export class VoiceError extends Error {
  readonly code: VoiceErrorCode;

  constructor(code: VoiceErrorCode, message?: string) {
    super(message ?? MESSAGES[code]);
    this.name = "VoiceError";
    this.code = code;
  }
}

/** Turn anything thrown into a VoiceError, so the UI only handles one shape. */
export function toVoiceError(error: unknown): VoiceError {
  if (error instanceof VoiceError) return error;
  return new VoiceError("server");
}

/** The JSON shape our /api/transcribe route sends back. Shared by server and client. */
export type TranscribeResponse =
  | { text: string }
  | { error: { code: VoiceErrorCode; message: string } };
