// Where the time goes in one turn, measured in the browser. Every mark is "ms since you
// let go", kept the first time it happens. At the end of the turn the marks are logged
// (in development) and kept in window.__relayTimings, so a test can read them.

export interface TurnTiming {
  question: string;
  marks: Record<string, number>;
  notes: Record<string, string | number>;
}

export interface TurnTimer {
  /** Record this moment, unless it was already recorded this turn. */
  mark(label: string): void;
  /** Keep an extra fact about the turn, e.g. the first chunk's length. */
  note(key: string, value: string | number): void;
  /** The turn is over: log it and keep it. */
  report(question: string): void;
}

export function createTurnTimer(releasedAt: number): TurnTimer {
  const marks: Record<string, number> = {};
  const notes: Record<string, string | number> = {};
  return {
    mark(label) {
      if (!(label in marks)) marks[label] = Math.round(performance.now() - releasedAt);
    },
    note(key, value) {
      notes[key] ??= value;
    },
    report(question) {
      const store = window as unknown as { __relayTimings?: TurnTiming[] };
      (store.__relayTimings ??= []).push({ question, marks: { ...marks }, notes: { ...notes } });
      if (process.env.NODE_ENV !== "production") console.info("[timing]", question, marks, notes);
    },
  };
}
