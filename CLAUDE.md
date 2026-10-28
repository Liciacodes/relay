@AGENTS.md

# Relay

A voice-first engineering briefing for GitHub. A developer talks to it, it answers out
loud, and it shows evidence for every claim it makes.

## Working with me

I'm learning. For every change, explain in plain words what it does and why, and name
the files touched. Prefer small, readable code over clever code. Introduce new concepts
(Web Audio, refs, server routes…) briefly the first time they appear.

## Roadmap (6 days)

- **Day 1 (done): voice input.** Hold to talk (button or Space), live waveform,
  Groq Whisper transcription, clear states and errors.
- **Day 2: voice output.** Streaming replies and spoken answers; the orb reacts to audio.
- Days 3–6: GitHub data, evidence for each claim, briefing flow, polish.

## Stack

Next.js 16 (App Router, Cache Components on) · React 19 · TypeScript · Tailwind v4 · ESM.
Read `node_modules/next/dist/docs/` before using a Next.js API (see AGENTS.md).
Note: with Cache Components, route files must not export `runtime`.

## Folder map

- `src/app/api/transcribe/route.ts`: server route; gets audio, calls Groq, returns `{ text }` or `{ error }`.
- `src/lib/server/`: server-only code (imports `server-only`). Secrets are used only here.
- `src/lib/audio/`: browser audio building blocks, no React:
  `mic.ts` (permission and errors), `recorder.ts` (MediaRecorder), `analyser.ts`
  (live levels, i.e. a `LevelSource`), `errors.ts` (error codes and messages), `types.ts`.
- `src/lib/transcribe.ts`: browser call to `/api/transcribe`.
- `src/hooks/`: `useVoiceCapture` (the state machine), `usePushToTalk` (hold input),
  `useReducedMotion`.
- `src/components/`: UI. `Waveform` draws on a canvas from a ref (no React re-renders).
  `OrbStage` is the placeholder for Day 2's orb.

## Rules

- **Secrets stay server-side.** Never prefix a secret with `NEXT_PUBLIC_`; never import
  `src/lib/server/*` from a client component.
- Voice states: `idle → requesting → recording → transcribing → done | error`.
  Add new states to `VoiceState` in `src/lib/audio/types.ts`.
- Space is handled only by the window listener in `usePushToTalk`; the button has no `onClick`.
- Recording auto-stops at 60s (`MAX_RECORDING_MS`) and transcribes what was captured.
- Respect `prefers-reduced-motion`; animate only transform and opacity; UI motion < 300ms.
- Colours are tokens in `src/app/globals.css`. Don't hard-code new colours.

## Running

```
cp .env.local.example .env.local   # then add GROQ_API_KEY
npm run dev                        # http://localhost:3000
npm run lint && npx tsc --noEmit   # checks
```
