import type { ReactNode } from "react";

/**
 * The stage for Relay's audio-reactive orb (Day 2). Today it's a quiet ring with the
 * waveform running across it. `live` brightens the ring while recording.
 */
export function OrbStage({ live, children }: { live: boolean; children: ReactNode }) {
  return (
    <div className="relative grid aspect-square w-[min(72vw,320px,38dvh)] place-items-center">
      <div data-live={live} aria-hidden="true" className="orb-ring absolute inset-0 rounded-full" />
      {/* The wave is wider than the ring, so it reads as a signal passing through. */}
      <div className="absolute top-1/2 left-1/2 h-28 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2">
        {children}
      </div>
    </div>
  );
}
