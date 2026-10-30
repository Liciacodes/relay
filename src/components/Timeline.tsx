import type { TimelineStep } from "@/lib/evidence";
import { formatSeconds } from "@/lib/format";

/**
 * What Relay did this turn, with real measured times:
 *   Heard you 0.8s   Checked commits in relay 0.4s   First word 2.1s   Started speaking 3.2s
 * Milestones count from when you let go; tool rows show how long that lookup took.
 *
 * It's an <ol> because the steps really are a sequence. No motion: it changes during
 * the turn, and movement would be noise next to the orb. Not aria-live either: the
 * status line already announces what's happening.
 */
export function Timeline({
  steps,
  stale,
  interrupted,
}: {
  steps: TimelineStep[];
  stale: boolean;
  /** You cut this turn off; its last step says "Interrupted". */
  interrupted: boolean;
}) {
  if (steps.length === 0) return null;

  return (
    <div data-stale={stale} data-interrupted={interrupted} className="timeline flex w-full max-w-2xl flex-col items-center gap-1">
      <ol
        aria-label="What Relay did, timed from when you let go"
        className="flex flex-wrap items-baseline justify-center gap-x-3 gap-y-1 text-[13px] text-muted"
      >
        {steps.map((step, index) => (
          <li key={index} className="timeline-step flex items-baseline gap-1.5">
            <span aria-hidden="true" className={step.ok ? undefined : "text-ember"}>
              {step.label}
            </span>
            <span aria-hidden="true" className="text-text/70 tabular-nums">
              {formatSeconds(step.ms)}
            </span>
            {/* What a screen reader says instead: "First word after 2.1 seconds". */}
            <span className="sr-only">
              {step.kind === "tool"
                ? `${step.label}, took ${(step.ms / 1000).toFixed(1)} seconds`
                : `${step.label} after ${(step.ms / 1000).toFixed(1)} seconds`}
            </span>
          </li>
        ))}
      </ol>
      {/* Screen readers already hear this in the list's label. */}
      <p aria-hidden="true" className="text-[12px] text-muted/60">
        Timed from when you let go
      </p>
    </div>
  );
}
