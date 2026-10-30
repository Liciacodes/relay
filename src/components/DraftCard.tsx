"use client";

import { useEffect, useId, useRef } from "react";
import type { DraftState } from "@/hooks/useConversation";

interface Props {
  draft: DraftState;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * An issue Relay drafted. Nothing exists on GitHub until you press Confirm.
 *
 * When it appears, focus moves to the card itself (screen readers read its heading), not to
 * Confirm: a stray Enter must never create an issue. Tab then reaches Confirm, then Cancel.
 */
export function DraftCard({ draft, onConfirm, onCancel }: Props) {
  const headingId = useId();
  const cardRef = useRef<HTMLElement>(null);
  const repoName = draft.repo.split("/")[1] ?? draft.repo;
  const creating = draft.status === "creating";
  // The visible word comes first in the spoken label, so voice-control users can say it.
  const confirmWord = creating ? "Creating…" : draft.status === "failed" ? "Try again" : "Confirm";

  // Focus the card once, when it first appears (not on every status change).
  useEffect(() => {
    cardRef.current?.focus();
  }, []);

  return (
    <section
      ref={cardRef}
      tabIndex={-1}
      aria-labelledby={headingId}
      className="draft-card w-full max-w-136 rounded-lg border border-line bg-panel px-4 py-3 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal"
    >
      <h2 id={headingId} className="text-xs text-muted">
        Draft issue for {repoName}
      </h2>
      <p className="mt-1 text-sm font-medium text-pretty text-text">{draft.title}</p>
      {draft.body && (
        <p className="mt-2 max-h-40 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap text-text/80">
          {draft.body}
        </p>
      )}
      <p className="mt-3 text-xs text-muted">Nothing is created on GitHub until you confirm.</p>

      {draft.status === "failed" && (
        <p role="alert" className="mt-2 text-sm text-ember">
          {draft.error}
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={creating ? undefined : onConfirm}
          aria-disabled={creating}
          aria-label={creating ? `Creating the issue in ${draft.repo}` : `${confirmWord}: create this issue in ${draft.repo}`}
          className="draft-button draft-confirm"
        >
          {confirmWord}
        </button>
        <button
          type="button"
          onClick={creating ? undefined : onCancel}
          aria-disabled={creating}
          aria-label="Cancel: discard this draft"
          className="draft-button"
        >
          Cancel
        </button>
      </div>
    </section>
  );
}
