"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { LevelSource } from "@/lib/audio/types";

const POINTS = 72; // how many points make up the wave's outline
const GAIN = 5; // speech is quiet in raw numbers; this makes it visible
const RISE = 0.35; // how fast the wave grows toward a louder sound (per 60fps frame)
const FALL = 0.2; // how fast it settles back: a little slower, so it feels calm

interface Props {
  /** Read every frame. Null means silence. */
  levelsRef: RefObject<LevelSource | null>;
  /** True while recording. When false, the wave settles flat and the loop stops. */
  active: boolean;
  reducedMotion: boolean;
}

/**
 * The live waveform. It's drawn on a canvas with requestAnimationFrame, and reads audio
 * from a ref, so React never re-renders 60 times a second. Only the canvas changes.
 */
export function Waveform({ levelsRef, active, reducedMotion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // Current displayed height of each point (0–1). Kept between renders so the wave
  // settles smoothly instead of snapping when recording stops.
  const heights = useRef(new Float32Array(POINTS));

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    // Colours come from the CSS tokens in globals.css, so there's one source of truth.
    const styles = getComputedStyle(canvas);
    const color = styles.getPropertyValue("--signal").trim() || "#9cc4e4";
    const line = styles.getPropertyValue("--line").trim() || "#26313d";
    let samples = new Float32Array(2048);
    let frame = 0;
    let lastTime = performance.now();

    // Match the canvas's pixel size to its CSS size × screen density, so lines stay sharp.
    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw();
    };

    // 1) Turn raw samples into one loudness value per point.
    const readTargets = (targets: Float32Array) => {
      const source = levelsRef.current;
      if (!active || !source) return targets.fill(0);
      if (samples.length !== source.size) samples = new Float32Array(source.size);
      source.readWaveform(samples);

      const perPoint = Math.floor(samples.length / POINTS);
      for (let i = 0; i < POINTS; i++) {
        let sum = 0;
        for (let j = i * perPoint; j < (i + 1) * perPoint; j++) sum += samples[j] * samples[j];
        const rms = Math.sqrt(sum / perPoint); // "root mean square" = average loudness
        // Taper toward both ends, so the wave swells in the middle like a lens.
        const taper = Math.sin((Math.PI * (i + 0.5)) / POINTS) ** 1.6;
        targets[i] = Math.min(1, rms * GAIN) * taper;
      }
      return targets;
    };

    // 2) Move each point a fraction of the way toward its target (a "lerp"), scaled by
    //    elapsed time so it looks the same at 60Hz or 120Hz.
    const targets = new Float32Array(POINTS);
    const step = (dt: number) => {
      readTargets(targets);
      const h = heights.current;
      let settled = true;
      for (let i = 0; i < POINTS; i++) {
        const rate = targets[i] > h[i] ? RISE : FALL;
        h[i] += (targets[i] - h[i]) * (1 - (1 - rate) ** (dt / 16.67));
        if (h[i] > 0.002) settled = false;
      }
      // Average with neighbours so the outline is smooth, not spiky.
      for (let i = 1; i < POINTS - 1; i++) h[i] = (h[i - 1] + h[i] * 2 + h[i + 1]) / 4;
      return settled;
    };

    // 3) Draw.
    const draw = () => {
      const w = canvas.clientWidth;
      const hgt = canvas.clientHeight;
      const mid = hgt / 2;
      const h = heights.current;
      ctx.clearRect(0, 0, w, hgt);

      // The resting line: always there, so the stage never looks empty or broken.
      ctx.fillStyle = line;
      ctx.fillRect(0, mid - 0.5, w, 1);

      if (reducedMotion) {
        // Calm alternative: one bar that grows with loudness. No waving shape.
        let level = 0;
        for (let i = 0; i < POINTS; i++) level = Math.max(level, h[i]);
        const barWidth = w * 0.6 * level;
        ctx.fillStyle = color;
        ctx.fillRect((w - barWidth) / 2, mid - 1.5, barWidth, 3);
        return;
      }

      const amp = mid * 0.9;
      const xAt = (i: number) => (i / (POINTS - 1)) * w;
      const yAt = (i: number, side: 1 | -1) => mid + side * Math.max(0.5, h[i] * amp);

      // Trace the top edge left→right, then the bottom edge right→left, as one shape.
      // Curving through the midpoints between points gives a smooth outline.
      ctx.beginPath();
      ctx.moveTo(0, mid);
      for (const side of [-1, 1] as const) {
        const order = side === -1 ? [...Array(POINTS).keys()] : [...Array(POINTS).keys()].reverse();
        for (let k = 0; k < order.length - 1; k++) {
          const a = order[k];
          const b = order[k + 1];
          ctx.quadraticCurveTo(xAt(a), yAt(a, side), (xAt(a) + xAt(b)) / 2, (yAt(a, side) + yAt(b, side)) / 2);
        }
        ctx.lineTo(side === -1 ? w : 0, mid);
      }
      ctx.closePath();

      // Fade the shape out at the edges.
      const fade = ctx.createLinearGradient(0, 0, w, 0);
      fade.addColorStop(0, "transparent");
      fade.addColorStop(0.5, color);
      fade.addColorStop(1, "transparent");
      ctx.fillStyle = fade;
      ctx.globalAlpha = 0.9;
      ctx.fill();
      ctx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      const settled = step(Math.min(64, now - lastTime));
      lastTime = now;
      draw();
      // Stop the loop once silent and flat: no wasted battery while idle.
      if (!active && settled) return;
      frame = requestAnimationFrame(loop);
    };

    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    resize();
    frame = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [active, reducedMotion, levelsRef]);

  // aria-hidden: purely visual. The status line says "Listening" in words.
  return <canvas ref={canvasRef} aria-hidden="true" className="block h-full w-full" />;
}
