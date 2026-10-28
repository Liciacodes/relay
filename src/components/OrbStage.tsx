import type { ReactNode } from "react";

/**
 * The stage: a quiet ring holding Relay's orb, with the mic waveform running across it.
 * `live` brightens the ring while you're recording.
 */
export function OrbStage({ live, orb, children }: { live: boolean; orb: ReactNode; children: ReactNode }) {
  return (
    <div className="relative grid aspect-square w-[min(72vw,300px,34dvh)] place-items-center">
      <div data-live={live} aria-hidden="true" className="orb-ring absolute inset-0 rounded-full" />
      {orb}
      {/* The wave is wider than the ring, so it reads as a signal passing through. */}
      <div className="absolute top-1/2 left-1/2 h-28 w-[min(92vw,560px)] -translate-x-1/2 -translate-y-1/2">
        {children}
      </div>
    </div>
  );
}
