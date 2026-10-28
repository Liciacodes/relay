/**
 * What you said, set in the reading serif. Keeps showing the last transcript
 * (dimmed) while a new one is being made, so the screen doesn't jump.
 */
export function Transcript({ text, stale }: { text: string | null; stale: boolean }) {
  return (
    <section aria-label="Transcript" aria-live="polite" aria-busy={stale} className="min-h-14 w-full max-w-136 text-center">
      {text ? (
        <blockquote
          key={text} // new text = new element, so its entrance plays each time
          data-stale={stale}
          className="transcript font-serif text-[1.375rem] leading-[1.55] text-balance text-text"
        >
          {text}
        </blockquote>
      ) : (
        <p className="font-serif text-[1.375rem] leading-[1.55] text-muted/70 italic">
          Your words will appear here.
        </p>
      )}
    </section>
  );
}
