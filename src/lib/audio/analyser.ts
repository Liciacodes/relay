import type { LevelSource } from "./types";

/**
 * Connect a stream to a Web Audio AnalyserNode, which lets us read the sound wave
 * every frame without touching the recording. The waveform (and on Day 2, the orb)
 * reads from this.
 */
export function analyseStream(stream: MediaStream): LevelSource {
  const context = new AudioContext();
  const source = context.createMediaStreamSource(stream);
  const analyser = context.createAnalyser();
  analyser.fftSize = 2048; // samples per read: about 43ms of audio at 48kHz
  source.connect(analyser); // not connected to the speakers, so you don't hear yourself

  return {
    size: analyser.fftSize,
    readWaveform(target) {
      analyser.getFloatTimeDomainData(target);
    },
    close() {
      source.disconnect();
      void context.close();
    },
  };
}
