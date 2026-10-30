import { useId, type CSSProperties } from "react";
import type { Evidence } from "@/lib/evidence";
import { EvidenceCard } from "./EvidenceCard";

/**
 * The proof under an answer: the GitHub items the tools returned, at most 6, most
 * relevant first (ranked on the server). Nothing is shown if no tool ran.
 *
 * Each card fades in and rises 6px, one after another (`--i` sets the delay, see
 * .evidence-item in globals.css). It's the one orchestrated moment of a turn.
 * A list, so screen readers say "list, 4 items"; not aria-live, so it doesn't talk over Relay.
 */
export function EvidenceList({
  items,
  stale,
  interrupted,
}: {
  items: Evidence[];
  stale: boolean;
  /** These came with an answer you cut off. */
  interrupted: boolean;
}) {
  const headingId = useId();
  if (items.length === 0) return null;

  return (
    <section aria-labelledby={headingId} data-stale={stale} data-interrupted={interrupted} className="evidence mt-4 w-full max-w-136">
      <h2 id={headingId} className="mb-2 text-[13px] text-muted">
        Sources
      </h2>
      <ul className="grid gap-2 sm:grid-cols-2">
        {items.map((item, index) => (
          <li key={item.url} className="evidence-item flex" style={{ "--i": index } as CSSProperties}>
            <EvidenceCard evidence={item} />
          </li>
        ))}
      </ul>
    </section>
  );
}
