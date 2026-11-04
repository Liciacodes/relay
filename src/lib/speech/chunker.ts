// Turns streaming answer text into pieces worth sending to the voice.
//
// Rules (to start talking fast, but use few Groq speech requests):
// 1. The first complete sentence is sent on its own, so speech starts quickly. If it's
//    long, only its start is: up to the first comma after FIRST_MIN characters.
//    (Measured: Orpheus needs ~0.5–1s for a short sentence, ~2.4s for 170 characters.)
// 2. Later sentences are packed together, up to MAX_CHUNK characters per piece.
// 3. A single sentence longer than MAX_CHUNK is split at a comma or space.
//
// Commit hashes are never spoken: `withoutHashes` takes them out of every piece.

export const MAX_CHUNK = 200; // Groq Orpheus accepts at most 200 characters
const FIRST_MIN = 40; // a first chunk shorter than this is never cut
const FIRST_LONG = 60; // a first sentence longer than this gets cut at a comma

/** Split a long first sentence at its first comma after FIRST_MIN characters, if any. */
function cutFirst(sentence: string): string[] {
  const text = sentence.trim();
  if (!text) return [];
  if (text.length <= FIRST_LONG) return [text];
  const comma = text.indexOf(", ", FIRST_MIN);
  if (comma === -1 || comma >= MAX_CHUNK) return [text];
  return [text.slice(0, comma + 1), text.slice(comma + 2)];
}

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

// A commit hash, like "a1b2c3d" or all 40 characters: one word (`\b` = the edge of a word)
// of 7 or more characters, only 0-9 and a-f. The space before it goes too, and quotes or
// brackets around it, so "Merge commit 'a1b2c3d' into main" becomes "Merge commit into main".
const HEX_WORD = / ?["'(]?\b[0-9a-f]{7,}\b["')]?/gi;
/** A real hash mixes digits and letters, so "1500000" and words like "defaced" stay. */
const isHash = (word: string) => /\d/.test(word) && /[a-f]/i.test(word);

/**
 * The text without commit hashes. The model is told never to say them, and no longer sees
 * them in tool results, but one can still hide in a commit message ("Merge commit 'a1b2c3d'").
 * The evidence cards show the hashes; the voice skips them.
 */
export function withoutHashes(text: string): string {
  return text.replace(HEX_WORD, (match) => (isHash(match) ? "" : match));
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

  // Every piece leaves through here, so this is where hashes are taken out.
  const send = (text: string) => {
    const spoken = withoutHashes(text).trim();
    if (spoken) onChunk(spoken);
  };

  const addSentence = (sentence: string) => {
    const pieces = sentFirst ? splitLong(sentence) : cutFirst(sentence).flatMap(splitLong);
    for (const piece of pieces) {
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
