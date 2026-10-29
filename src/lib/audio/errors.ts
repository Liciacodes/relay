// Every way a voice turn can fail, as a small fixed list of codes.
// The UI switches on the code; the message is what the person reads.

export type VoiceErrorCode =
  | "permission-denied" // the person (or browser policy) blocked the mic
  | "no-mic" // no input device is connected
  | "mic-busy" // another app holds the mic exclusively
  | "unsupported" // browser can't record, or the page isn't on https/localhost
  | "network" // a request to our server never got an answer
  | "empty-audio" // too short, silent, or nothing was transcribed
  | "rate-limited" // Groq said "too many requests"
  | "reply-failed" // the answer couldn't be generated or was cut off
  | "speech-failed" // neither Groq's voice nor the browser's could speak
  | "github-token" // GITHUB_TOKEN is missing or GitHub rejected it
  | "github-rate-limited" // GitHub said "too many requests"
  | "server"; // anything else that went wrong on our server

const MESSAGES: Record<VoiceErrorCode, string> = {
  "permission-denied":
    "Microphone access is blocked. Allow it in your browser's site settings, then try again.",
  "no-mic": "No microphone found. Connect one and try again.",
  "mic-busy": "Another app is using your microphone. Close it and try again.",
  unsupported:
    "This browser can't record audio here. Use a recent browser, on localhost or https.",
  network: "Couldn't reach the server. Check your connection and try again.",
  "empty-audio": "Nothing to transcribe. Keep holding while you speak, then let go.",
  "rate-limited": "Groq's usage limit was reached. Try again in a minute.",
  "reply-failed": "Couldn't get an answer. Try again.",
  "speech-failed": "Couldn't speak the answer. It's shown on screen.",
  "github-token": "GitHub rejected the token. Check GITHUB_TOKEN in .env.local.",
  "github-rate-limited": "GitHub's usage limit was reached. Try again in a few minutes.",
  server: "Something went wrong on the server. Try again in a moment.",
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
export function toVoiceError(error: unknown, fallback: VoiceErrorCode = "server"): VoiceError {
  if (error instanceof VoiceError) return error;
  return new VoiceError(fallback);
}

/** The JSON every API route sends when something fails. Shared by server and client. */
export interface ApiError {
  error: { code: VoiceErrorCode; message: string };
}

/** What /api/transcribe sends back. */
export type TranscribeResponse = { text: string } | ApiError;

/** Read our `{ error }` JSON from a failed response. Falls back to `fallback` if it's missing. */
export async function errorFromResponse(response: Response, fallback: VoiceErrorCode) {
  const data = (await response.json().catch(() => null)) as Partial<ApiError> | null;
  return data?.error ? new VoiceError(data.error.code, data.error.message) : new VoiceError(fallback);
}
