/**
 * Relay's answer, growing word by word as it streams in. Set in the interface sans, so
 * it reads as a different voice from your words (in the serif) above it.
 *
 * aria-busy tells screen readers "still changing, wait": they announce the answer once it's
 * complete instead of re-reading it after every word.
 */
export function Reply({ text, streaming, stale }: { text: string | null; streaming: boolean; stale: boolean }) {
  return (
    <section
      aria-label="Relay's answer"
      aria-live="polite"
      aria-busy={streaming}
      className="min-h-16 w-full max-w-136 text-center"
    >
      {text && (
        <p
          data-stale={stale}
          className="reply text-[1.0625rem] leading-[1.6] text-pretty text-text/85"
        >
          {text}
        </p>
      )}
    </section>
  );
}
