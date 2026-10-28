import { VoiceError, errorFromResponse } from "./audio/errors";
import type { Turn } from "./audio/types";

const TIMEOUT_MS = 45_000;

/**
 * Browser side: ask /api/reply for an answer and receive it as it's written.
 *
 * `response.body` is a ReadableStream of bytes. We read it piece by piece with a "reader",
 * turn the bytes into text with a TextDecoder, and hand each piece to `onText` right away.
 * Returns the full answer once the stream ends.
 */
export async function streamReply(
  text: string,
  history: Turn[],
  onText: (piece: string) => void,
): Promise<string> {
  let response: Response;
  try {
    response = await fetch("/api/reply", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, history }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    throw new VoiceError("network");
  }

  // Failures before the answer started (bad request, rate limit) come back as JSON.
  if (!response.ok || !response.body) throw await errorFromResponse(response, "reply-failed");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let answer = "";

  try {
    while (true) {
      const { done, value } = await reader.read(); // waits for the next piece
      if (done) break;
      // stream: true = a character split across two pieces is kept until it's complete
      const piece = decoder.decode(value, { stream: true });
      if (piece) {
        answer += piece;
        onText(piece);
      }
    }
  } catch {
    // The connection broke halfway: Groq failed mid-answer, or the network dropped.
    throw new VoiceError("reply-failed", "The answer was cut off. Try again.");
  }

  if (!answer.trim()) throw new VoiceError("reply-failed");
  return answer;
}
