import type { Evidence } from "@/lib/evidence";
import { formatWhen } from "@/lib/format";

interface Props {
  evidence: Evidence;
}

export function EvidenceCard({ evidence }: Props) {
  // Step 1: a readable name for what kind of card this is
  let kindLabel = "";
  if (evidence.kind === "commit") kindLabel = `Commit ${evidence.sha ?? ""}`;
  if (evidence.kind === "pr") kindLabel = `Pull request #${evidence.number}`;
  if (evidence.kind === "issue") kindLabel = `Issue #${evidence.number}`;
  if (evidence.kind === "repo") kindLabel = "Repository";

  // Step 2: show "reviewpal" instead of "Liciacodes/reviewpal"
  const repoName = evidence.repo.split("/")[1] ?? evidence.repo;

  // Step 3: one clear sentence for screen readers
  const label = `${kindLabel}, ${evidence.title}, in ${repoName}, ${evidence.dateLabel.toLowerCase()} ${formatWhen(evidence.date)}, opens in a new tab`;

  // TODO (step 4): hover, press and focus states

  return (
    <a
      href={evidence.url}
      aria-label={label}
      target="_blank" 
      rel="noopener noreferrer" 
      className="block w-full rounded-lg border border-line bg-panel px-4 py-3 text-sm text-text transition-[transform,border-color] duration-[140ms] ease-[var(--ease-out)] hover:border-muted active:scale-[0.98] motion-reduce:active:scale-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    >
      <span className="block text-xs text-muted">{kindLabel}</span>
      <span className="mt-1 block font-medium line-clamp-2">{evidence.title}</span>
      <span className="mt-2 flex gap-3 text-xs text-muted">
        {evidence.kind !== "repo" && <span>{repoName}</span>}
        <span>
          {evidence.dateLabel} {formatWhen(evidence.date)}
        </span>
      </span>
    </a>
  );
}