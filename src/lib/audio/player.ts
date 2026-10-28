import { levelSourceFrom } from "./analyser";
import type { LevelSource } from "./types";

export interface AudioPlayer {
  /**
   * Browsers only allow sound after a user gesture (a click or key press). Call this
   * inside one, e.g. when the talk button is pressed, so later playback is allowed.
   */
  unlock(): void;
  /** Decode a WAV clip and schedule it right after anything already queued. */
  play(wav: ArrayBuffer): Promise<{ ended: Promise<void> }>;
  /** Stop everything queued (used when a reply fails halfway). */
  stopAll(): void;
  /** Live levels of what's playing, for the orb. */
  readonly levels: LevelSource;
}

/**
 * Plays Relay's voice. Every clip goes through one AnalyserNode on its way to the
 * speakers, and is scheduled on the AudioContext's own clock so clips join with no gap.
 */
export function createAudioPlayer(): AudioPlayer {
  let context: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let nextStartTime = 0; // when the next clip should begin, in AudioContext seconds
  const playing = new Set<AudioBufferSourceNode>();

  const ensureContext = () => {
    if (!context) {
      context = new AudioContext();
      analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      analyser.connect(context.destination); // destination = the speakers
    }
    return { context, analyser: analyser! };
  };

  // The orb may read before anything plays; report silence until then.
  const silence: LevelSource = { size: 2048, readWaveform: (t) => t.fill(0), close() {} };
  let realLevels: LevelSource | null = null;

  return {
    unlock() {
      const { context, analyser } = ensureContext();
      realLevels ??= levelSourceFrom(analyser, () => {});
      if (context.state === "suspended") void context.resume();
    },

    async play(wav) {
      const { context, analyser } = ensureContext();
      const buffer = await context.decodeAudioData(wav); // WAV bytes → raw samples
      const source = context.createBufferSource();
      source.buffer = buffer;
      source.connect(analyser);

      // Start after the previous clip, or almost immediately if nothing is queued.
      const startAt = Math.max(context.currentTime + 0.03, nextStartTime);
      nextStartTime = startAt + buffer.duration;
      source.start(startAt);
      playing.add(source);

      const ended = new Promise<void>((resolve) => {
        source.addEventListener("ended", () => {
          playing.delete(source);
          resolve();
        });
      });
      return { ended };
    },

    stopAll() {
      for (const source of playing) source.stop();
      playing.clear();
      nextStartTime = 0;
    },

    levels: {
      size: 2048,
      readWaveform: (target) => (realLevels ?? silence).readWaveform(target),
      close() {},
    },
  };
}
