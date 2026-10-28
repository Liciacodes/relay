// Turns streaming answer text into pieces worth sending to the voice.
//
// Rules (to start talking fast, but use few Groq speech requests):
// 1. The first complete sentence is sent on its own, so speech starts quickly.
// 2. Later sentences are packed together, up to MAX_CHUNK characters per piece.
// 3. A single sentence longer than MAX_CHUNK is split at a comma or space.

export const MAX_CHUNK = 200; // Groq Orpheus accepts at most 200 characters

// A sentence ends with . ! ? or … (maybe followed by a closing quote/bracket) and then a space.
// Requiring the space avoids splitting "3.5" or "v2.0" in the middle.
const SENTENCE_END = /[.!?…]+["'”’)\]]?(?=\s)/g;

/** Split text that's too long for one request into ≤ MAX_CHUNK pieces. */
export function splitLong(text: string): string[] {
  const pieces: string[] = [];
  let rest = text.trim();
  while (rest.length > MAX_CHUNK) {
    const window = rest.slice(0, MAX_CHUNK);
    // Prefer breaking after a comma, then at a space, then anywhere.
    let cut = window.lastIndexOf(", ") + 1;
    if (cut < MAX_CHUNK / 2) cut = window.lastIndexOf(" ");
    if (cut < MAX_CHUNK / 2) cut = MAX_CHUNK;
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest) pieces.push(rest);
  return pieces;
}

export interface SpeechChunker {
  /** Feed the next piece of streamed text. */
  push(text: string): void;
  /** The answer is complete: send whatever is left. */
  flush(): void;
}

export function createSpeechChunker(onChunk: (chunk: string) => void): SpeechChunker {
  let unfinished = ""; // text that doesn't end a sentence yet
  let packed = ""; // complete sentences waiting to be sent together
  let sentFirst = false;

  const send = (text: string) => {
    if (text.trim()) onChunk(text.trim());
  };

  const addSentence = (sentence: string) => {
    for (const piece of splitLong(sentence)) {
      if (!sentFirst) {
        sentFirst = true;
        send(piece); // rule 1: first sentence alone
        continue;
      }
      const joined = packed ? `${packed} ${piece}` : piece;
      if (joined.length <= MAX_CHUNK) {
        packed = joined; // rule 2: still fits, keep packing
      } else {
        send(packed);
        packed = piece;
      }
    }
  };

  return {
    push(text) {
      unfinished += text;
      let consumed = 0;
      for (const match of unfinished.matchAll(SENTENCE_END)) {
        const end = match.index + match[0].length;
        addSentence(unfinished.slice(consumed, end));
        consumed = end;
      }
      unfinished = unfinished.slice(consumed);
    },
    flush() {
      addSentence(unfinished);
      unfinished = "";
      send(packed);
      packed = "";
    },
  };
}
