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
- **Day 2 (done): voice output.** Streamed replies (Groq `openai/gpt-oss-20b`), spoken by
  Groq Orpheus with a browser-voice fallback, audio-reactive orb, short conversation memory.
- Day 3: GitHub tools. Day 4: evidence for each claim. Day 5: interruption. Day 6: polish.

## Stack

Next.js 16 (App Router, Cache Components on) · React 19 · TypeScript · Tailwind v4 · ESM.
Read `node_modules/next/dist/docs/` before using a Next.js API (see AGENTS.md).
Note: with Cache Components, route files must not export `runtime`.

## Folder map

- `src/app/api/`: server routes. All failures return `{ error: { code, message } }`.
  - `transcribe/`: audio → `{ text }` (Whisper).
  - `reply/`: `{ text, history }` → **streamed plain text** (chat model).
  - `speak/`: `{ text }` (≤ 200 chars) → `audio/wav` (Orpheus).
- `src/lib/server/`: server-only code (imports `server-only`). Secrets are used only here.
  `groq.ts` (all Groq calls, model IDs, system prompt, SSE parsing, WAV header fix),
  `respond.ts` (`fail()`, `requireApiKey()`, `groqFailure()` error mapping).
- `src/lib/audio/`: browser audio building blocks, no React:
  `mic.ts`, `recorder.ts`, `analyser.ts` (`levelSourceFrom` → a `LevelSource`),
  `player.ts` (gapless playback on one AudioContext, unlocked on press),
  `errors.ts` (error codes, messages, `errorFromResponse`), `types.ts`.
- `src/lib/speech/`: `chunker.ts` (first sentence alone, then ≤ 200-char packs),
  `speaker.ts` (fetches + plays chunks in order, falls back to the browser voice),
  `browserVoice.ts` (speechSynthesis + simulated levels).
- `src/lib/transcribe.ts`, `src/lib/reply.ts`: browser calls to the routes.
- `src/hooks/`: `useConversation` (the whole loop / state machine), `usePushToTalk`
  (hold input), `useReducedMotion`.
- `src/components/`: UI. `Waveform` (mic) and `Orb` (Relay's voice) draw on canvases from
  refs (no React re-renders). `Reply` shows the streaming answer.

## Rules

- **Secrets stay server-side.** Never prefix a secret with `NEXT_PUBLIC_`; never import
  `src/lib/server/*` from a client component.
- Voice states: `idle → requesting → recording → transcribing → thinking → speaking → done | error`.
  Add new states to `VoiceState` in `src/lib/audio/types.ts`. Presses are ignored while
  transcribing/thinking/speaking (interruption is Day 5).
- Groq limits are tight (Orpheus may allow ~100 requests/day): keep the chunker's packing,
  and mock `/api/reply` and `/api/speak` in tests unless real calls are needed.
- Orpheus needs its terms accepted once in the Groq console; until then speech falls back
  to the browser voice (`model_terms_required`).
- Model IDs live only in `src/lib/server/groq.ts`. Groq retires models often; check
  `GET https://api.groq.com/openai/v1/models` before changing them.
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
