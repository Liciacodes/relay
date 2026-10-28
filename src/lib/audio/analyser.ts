import type { LevelSource } from "./types";

/**
 * Wrap a Web Audio AnalyserNode as a LevelSource: something the waveform and the orb can
 * read every frame. Both the mic (below) and Relay's voice (player.ts) use this.
 */
export function levelSourceFrom(analyser: AnalyserNode, close: () => void): LevelSource {
  return {
    size: analyser.fftSize,
    readWaveform(target) {
      analyser.getFloatTimeDomainData(target);
    },
    close,
  };
}

/**
 * Connect a mic stream to an AnalyserNode, which lets us read the sound wave every frame
 * without touching the recording.
 */
export function analyseStream(stream: MediaStream): LevelSource {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048; // samples per read: about 43ms of audio at 48kHz
  source.connect(analyser); // not connected to the speakers, so you don't hear yourself

  return levelSourceFrom(analyser, () => {
    source.disconnect();
    void context.close();
  });
}
