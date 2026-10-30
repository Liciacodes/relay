import { VoiceError, errorFromResponse } from "@/lib/audio/errors";
import type { AudioPlayer } from "@/lib/audio/player";
import type { LevelSource } from "@/lib/audio/types";
import { browserVoiceAvailable, createBrowserVoice } from "./browserVoice";

/** Fetch one chunk of speech from our server. Never throws: failures come back as values. */
async function fetchSpeech(text: string, cancelled: AbortSignal): Promise<{ wav: ArrayBuffer } | { error: VoiceError }> {
  try {
    const response = await fetch("/api/speak", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
      signal: AbortSignal.any([cancelled, AbortSignal.timeout(20_000)]),
    });
    if (!response.ok) return { error: await errorFromResponse(response, "speech-failed") };
    return { wav: await response.arrayBuffer() };
  } catch {
    return { error: new VoiceError("network") };
  }
}

export interface Speaker {
  /** Speak this chunk after the ones before it. Its audio starts downloading immediately. */
  say(chunk: string): void;
  /** No more chunks are coming. */
  end(): void;
  /** Resolves once everything has been spoken. Rejects with "speech-failed" if no voice worked. */
  readonly finished: Promise<void>;
  /** Stop speaking right away (used when the reply itself fails). */
  stopAll(): void;
  /**
   * You interrupted: stop now AND for good. Chunks still downloading are dropped instead
   * of playing a moment later, nothing new is queued, and `finished` resolves.
   */
  cancel(): void;
  /** Live levels of Relay's voice, for the orb (real or simulated). */
  readonly levels: LevelSource;
}

interface Options {
  /** Called once, when the first sound is about to play. */
  onFirstAudio: () => void;
  /** Called once if Groq's voice fails and the browser's voice takes over. */
  onFallback: (reason: VoiceError) => void;
  /** For timing: a chunk's audio was requested, or arrived. */
  onTiming?: (event: "speak-sent" | "audio-back") => void;
}

/**
 * The speaking pipeline for one reply.
 *
 * Chunks may arrive faster than they can be spoken, and their audio downloads at different
 * speeds. Two promise chains keep things in order:
 * - `scheduled` makes sure chunk 2 is queued only after chunk 1 has been queued.
 * - `played` resolves when everything queued so far has finished playing.
 */
export function createSpeaker(player: AudioPlayer, { onFirstAudio, onFallback, onTiming }: Options): Speaker {
  let mode: "groq" | "browser" = "groq";
  const browser = browserVoiceAvailable() ? createBrowserVoice() : null;
  let scheduled: Promise<void> = Promise.resolve();
  let played: Promise<void> = Promise.resolve();
  let started = false;
  let requested = false; // has any chunk been asked for yet?
  let failure: VoiceError | null = null;
  const cancelled = new AbortController();

  const markStarted = () => {
    if (!started && !cancelled.signal.aborted) {
      started = true;
      onFirstAudio();
    }
  };

  const switchToBrowser = (reason: VoiceError) => {
    if (mode === "browser") return;
    mode = "browser";
    if (browser) onFallback(reason);
  };

  const speakWithBrowser = (chunk: string) => {
    if (!browser) {
      failure = new VoiceError("speech-failed");
      return;
    }
    // Wait for any Groq audio still playing, then let the browser speak.
    // The .catch keeps `played` from ever rejecting; the failure is reported via `finished`.
    played = played
      .then(() => {
        if (cancelled.signal.aborted) return;
        markStarted();
        return browser.speak(chunk);
      })
      .catch(() => {
        failure = new VoiceError("speech-failed");
      });
  };

  let resolveEnd!: () => void;
  const ended = new Promise<void>((resolve) => (resolveEnd = resolve));

  return {
    say(chunk) {
      if (cancelled.signal.aborted) return;
      // Start downloading now, even if earlier chunks are still being spoken.
      // Timing follows the FIRST chunk only: it decides when Relay starts talking.
      const first = !requested;
      requested = true;
      if (mode === "groq" && first) onTiming?.("speak-sent");
      const audio =
        mode === "groq"
          ? fetchSpeech(chunk, cancelled.signal).then((result) => {
              if (first) onTiming?.("audio-back");
              return result;
            })
          : null;

      scheduled = scheduled.then(async () => {
        if (cancelled.signal.aborted) return; // interrupted while this was downloading
        if (mode === "groq" && audio) {
          const result = await audio;
          if (cancelled.signal.aborted) return;
          if ("wav" in result) {
            try {
              const { ended } = await player.play(result.wav);
              // Interrupted while it was being decoded: silence it before it's heard.
              if (cancelled.signal.aborted) return player.stopAll();
              markStarted();
              played = Promise.all([played, ended]).then(() => {});
              return;
            } catch {
              switchToBrowser(new VoiceError("speech-failed", "Groq's audio couldn't be played."));
            }
          } else {
            switchToBrowser(result.error);
          }
        }
        speakWithBrowser(chunk);
      });
    },

    end() {
      resolveEnd();
    },

    finished: ended
      .then(() => scheduled)
      .then(() => played)
      .then(() => {
        if (failure) throw failure;
      }),

    stopAll() {
      player.stopAll();
      browser?.stopAll();
    },

    cancel() {
      cancelled.abort(); // drops queued chunks and their downloads
      failure = null;
      player.stopAll();
      browser?.stopAll();
      resolveEnd();
    },

    levels: {
      size: 2048,
      readWaveform(target) {
        if (mode === "browser" && browser) browser.levels.readWaveform(target);
        else player.levels.readWaveform(target);
      },
      close() {},
    },
  };
}
