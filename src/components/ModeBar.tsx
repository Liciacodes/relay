"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Access } from "@/hooks/useConversation";

const linkClass =
  "rounded-sm text-text underline decoration-muted/60 underline-offset-4 hover:decoration-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal";

/**
 * One quiet line saying which version of Relay this is. In the public demo, visitors see
 * whose GitHub it is and what to try; the owner can unlock full mode with the password.
 * (This only shows the mode: the server enforces it on every request.)
 */
export function ModeBar({ access, onChange }: { access: Access; onChange: (access: Access) => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const owner = access.owner ?? "the owner";

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const unlock = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const password = new FormData(event.currentTarget).get("password");
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = (await response.json().catch(() => null)) as { error?: { message: string } } | null;
      if (!response.ok) return setError(data?.error?.message ?? "Couldn't unlock. Try again.");
      setOpen(false);
      onChange({ ...access, mode: "full" });
    } catch {
      setError("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const lock = async () => {
    await fetch("/api/unlock", { method: "DELETE" }).catch(() => {});
    onChange({ ...access, mode: "demo" });
  };

  if (access.mode === "full") {
    // No password set (your own computer): nothing to lock, so say nothing.
    if (!access.canUnlock) return null;
    return (
      <p className="w-full max-w-136 pt-3 text-center text-[13px] text-muted">
        Full mode: private repos and issues are on.{" "}
        <button type="button" onClick={() => void lock()} className={linkClass}>
          Lock
        </button>
      </p>
    );
  }

  return (
    <div className="flex w-full max-w-136 flex-col items-center gap-2 pt-3 text-center text-[13px] text-muted">
      <p>
        A demo of {owner}&apos;s GitHub: public repos, read-only. Try &ldquo;What did {owner} commit this week?&rdquo;
        {access.canUnlock && !open && (
          <>
            {" "}
            <button type="button" onClick={() => setOpen(true)} className={linkClass}>
              Unlock
            </button>
          </>
        )}
      </p>
      {open && (
        <form onSubmit={(event) => void unlock(event)} className="flex flex-wrap items-center justify-center gap-2">
          <label htmlFor="relay-password" className="sr-only">
            Owner password
          </label>
          <input
            ref={inputRef}
            id="relay-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            className="h-8 w-48 rounded-md border border-line bg-panel px-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-signal"
          />
          <button type="submit" aria-disabled={busy} className={linkClass}>
            {busy ? "Unlocking…" : "Unlock"}
          </button>
          <button type="button" onClick={() => setOpen(false)} className={linkClass}>
            Cancel
          </button>
          {error && (
            <p role="alert" className="basis-full text-ember">
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  );
}
