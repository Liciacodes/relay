"use client";

import { useEffect, useRef, type RefObject } from "react";
import type { LevelSource } from "@/lib/audio/types";

export type OrbMode = "idle" | "thinking" | "speaking";

const GAIN = 2.6; // voice audio is quiet in raw numbers; this makes it visible
const RISE = 0.3; // how fast the orb swells toward a louder sound (per 60fps frame)
const FALL = 0.1; // how fast it settles: slower, so it breathes rather than flickers
const BREATH_SECONDS = 2.8; // one slow in-and-out while thinking

interface Props {
  /** Relay's voice levels, read every frame while speaking. */
  levelsRef: RefObject<LevelSource | null>;
  mode: OrbMode;
  reducedMotion: boolean;
}

function hexToRgb(hex: string) {
  const n = parseInt(hex.replace("#", ""), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].join(", ");
}

/**
 * Relay's presence. Speaking: it swells and ripples with the voice. Thinking: a slow
 * breath. Idle: perfectly still (and no animation loop running at all).
 * Reduced motion: it never changes shape; only its glow brightens with the voice.
 */
export function Orb({ levelsRef, mode, reducedMotion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const level = useRef(0); // smoothed 0–1, kept between renders so changes ease out

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const rgb = hexToRgb(getComputedStyle(canvas).getPropertyValue("--signal").trim() || "#9cc4e4");
    const samples = new Float32Array(2048);
    const start = performance.now();
    let lastTime = start;
    let frame = 0;

    // How loud is Relay right now? Root-mean-square of the latest samples.
    const voiceLevel = () => {
      const source = levelsRef.current;
      if (!source) return 0;
      source.readWaveform(samples);
      let sum = 0;
      for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
      return Math.min(1, Math.sqrt(sum / samples.length) * GAIN);
    };

    const targetLevel = (seconds: number) => {
      if (mode === "speaking") return voiceLevel();
      if (mode === "thinking") {
        if (reducedMotion) return 0.2; // a steady, brighter state instead of a pulse
        return 0.1 + 0.1 * (0.5 - 0.5 * Math.cos((seconds * 2 * Math.PI) / BREATH_SECONDS));
      }
      return 0;
    };

    const draw = (seconds: number) => {
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const cx = w / 2;
      const cy = h / 2;
      const base = Math.min(w, h) * 0.3;
      const l = level.current;
      ctx.clearRect(0, 0, w, h);

      const radius = reducedMotion ? base : base * (0.95 + l * 0.14);

      // 1) The halo: a wide, soft glow that brightens with the voice.
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 1.65);
      halo.addColorStop(0, `rgba(${rgb}, ${0.05 + l * 0.35})`);
      halo.addColorStop(0.5, `rgba(${rgb}, ${0.02 + l * 0.14})`);
      halo.addColorStop(1, `rgba(${rgb}, 0)`);
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, w, h);

      // 2) The body: a circle whose edge ripples gently when there's sound.
      ctx.beginPath();
      const steps = 96;
      for (let i = 0; i <= steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const ripple = reducedMotion
          ? 0
          : l * (0.02 * Math.sin(3 * angle + seconds * 1.7) + 0.012 * Math.sin(5 * angle - seconds * 2.3));
        const r = radius * (1 + ripple);
        const x = cx + Math.cos(angle) * r;
        const y = cy + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.closePath();
      const body = ctx.createRadialGradient(cx, cy - radius * 0.25, 0, cx, cy, radius);
      body.addColorStop(0, `rgba(${rgb}, ${0.16 + l * 0.5})`);
      body.addColorStop(1, `rgba(${rgb}, ${0.03 + l * 0.12})`);
      ctx.fillStyle = body;
      ctx.fill();
    };

    const resize = () => {
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(canvas.clientWidth * dpr);
      canvas.height = Math.round(canvas.clientHeight * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      draw((performance.now() - start) / 1000);
    };

    const loop = (now: number) => {
      const seconds = (now - start) / 1000;
      const target = targetLevel(seconds);
      const rate = target > level.current ? RISE : FALL;
      // Ease toward the target, scaled by elapsed time so 60Hz and 120Hz look the same.
      level.current += (target - level.current) * (1 - (1 - rate) ** (Math.min(64, now - lastTime) / 16.67));
      lastTime = now;
      draw(seconds);
      // Idle and settled: stop the loop. Nothing moves, nothing costs battery.
      if (mode === "idle" && level.current < 0.002) return;
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
  }, [mode, reducedMotion, levelsRef]);

  // Purely visual; the status line says "Thinking" / "Speaking" in words.
  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 block h-full w-full" />;
}
