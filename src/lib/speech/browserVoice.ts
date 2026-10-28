import { VoiceError } from "@/lib/audio/errors";
import type { LevelSource } from "@/lib/audio/types";

/**
 * The fallback voice: the browser's built-in speechSynthesis. It needs no server and no
 * quota, but the browser doesn't let us measure its sound. So for the orb we make a
 * *simulated* level: a gentle pulse each time a word starts (the "boundary" event).
 */
export interface BrowserVoice {
  speak(text: string): Promise<void>;
  stopAll(): void;
  readonly levels: LevelSource;
}

export function browserVoiceAvailable() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

function pickVoice() {
  const voices = speechSynthesis.getVoices();
  const english = voices.filter((voice) => voice.lang.startsWith("en"));
  return english.find((voice) => voice.default) ?? english.find((voice) => voice.localService) ?? english[0];
}

export function createBrowserVoice(): BrowserVoice {
  let energy = 0; // 0–1, jumps up on each word, fades between words
  let lastTime = performance.now();
  let speaking = false;
  let phase = 0;

  const levels: LevelSource = {
    size: 2048,
    readWaveform(target) {
      const now = performance.now();
      energy *= Math.exp(-(now - lastTime) / 140); // fade out over ~140ms
      lastTime = now;
      const level = speaking ? 0.08 + energy * 0.18 : 0;
      // A soft sine wave at that loudness, so it reads like real audio.
      for (let i = 0; i < target.length; i++) {
        target[i] = Math.sin(phase + i * 0.06) * level;
      }
      phase += 0.9;
    },
    close() {},
  };

  return {
    levels,
    speak(text) {
      return new Promise((resolve, reject) => {
        const utterance = new SpeechSynthesisUtterance(text);
        const voice = pickVoice();
        if (voice) utterance.voice = voice;
        utterance.rate = 1.02;
        utterance.addEventListener("start", () => (speaking = true));
        utterance.addEventListener("boundary", () => (energy = 1));
        utterance.addEventListener("end", () => {
          speaking = false;
          resolve();
        });
        utterance.addEventListener("error", (event) => {
          speaking = false;
          // "interrupted"/"canceled" happen when we stop on purpose; not a failure.
          if (event.error === "interrupted" || event.error === "canceled") resolve();
          else reject(new VoiceError("speech-failed"));
        });
        speechSynthesis.speak(utterance); // the browser queues utterances in order
      });
    },
    stopAll() {
      speechSynthesis.cancel();
      speaking = false;
    },
  };
}
