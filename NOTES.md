# Relay: my notes

## 1. File structure

```
src/
├── app/                    pages and server routes (Next.js finds them by folder name)
│   ├── layout.tsx            fonts and dark theme, wraps every page
│   ├── page.tsx              the one page: header + VoiceConsole
│   ├── globals.css           colour tokens and component styles
│   └── api/                  server routes: the only doors to Groq
│       ├── transcribe/route.ts   audio → text
│       ├── reply/route.ts        question → streamed answer
│       └── speak/route.ts        text → WAV audio
├── components/             what you see: button, orb, waveform, transcript, reply
├── hooks/                  React glue: the conversation state machine and the hold-to-talk input
└── lib/                    plain logic, no React
    ├── audio/                browser sound: mic, recorder, analyser, player, error codes, types
    ├── speech/               turning the answer into speech: chunker, speaker, browser voice
    ├── server/               Groq calls and error responses (uses the secret key)
    ├── transcribe.ts         browser → /api/transcribe
    └── reply.ts              browser → /api/reply
```

**Why it's organised this way:** each layer depends only on the layers below it.

- `components` (what it looks like) uses `hooks` (when things happen).
- `hooks` use `lib` (how things work).
- `lib` knows nothing about React.

So I can change the look without touching the audio code, and I can reuse the audio code anywhere. For example, the waveform and the orb read the same `LevelSource`.

**Where each part runs:**

| Runs only on the server | Runs in the browser | Shared by both |
|---|---|---|
| `app/api/*` | `components/*` | `lib/audio/errors.ts` and `types.ts` (error codes and shapes, so both sides agree) |
| `lib/server/*` (its `import "server-only"` line breaks the build if browser code imports it, so the key can't leak) | `hooks/*` | |
| | `lib/audio/*`, `lib/speech/*`, `lib/transcribe.ts`, `lib/reply.ts` | |

`page.tsx` and `layout.tsx` are rendered into HTML on the server, then the browser takes over. Files marked `"use client"` run in the browser.

## 2. System design

```
 BROWSER                           OUR SERVER (Next.js)              GROQ
 ───────                           ────────────────────              ────
 hold button / Space
   mic → recorder ──audio────────▶ /api/transcribe ──+key──────────▶ Whisper
                   ◀──{ text }──────                ◀───────────────
   show transcript
                   ──{ text,     ─▶ /api/reply ──────+key──────────▶ gpt-oss-20b
                      history }                         (streams SSE)
                   ◀──plain text,────  strips SSE    ◀── data: {...}
                      piece by piece
   show reply text
   chunker ─chunk 1 (1st sentence)─▶ /api/speak ─────+key──────────▶ Orpheus
           ─chunk 2 (rest, ≤200)───▶ /api/speak ─────+key──────────▶ Orpheus
                   ◀──WAV───────────  fixes header   ◀───────────────
   player (one audio clock) → speakers
                            ↘ analyser → orb
   if /api/speak fails → browser speechSynthesis (no server, no Groq)
```

### Design decisions and their trade-offs

| Decision | Gain | Cost |
|---|---|---|
| The key stays on our server; the browser only talks to our own routes | The key can't be stolen from the browser | An extra hop, so a little slower |
| Three small routes instead of one big one | Each can fail on its own and be tested alone | More requests |
| Stream the answer | Words appear (and speech can start) before the answer is finished | Harder code; a failure halfway can't send a normal error |
| The server turns Groq's SSE into plain text | The browser code stays simple and doesn't depend on Groq's format | The server does a little parsing work |
| First sentence alone, the rest packed into chunks of up to 200 characters | Fast start, and about half the voice requests (about 100 a day allowed) | Later sentences wait until the pack is full or the answer ends |
| Download chunks in parallel, play them in order | No waiting between chunks | If Groq's voice fails, one extra request may already be on its way |
| One audio clock for playback | No gaps or overlaps between chunks | All sound must go through one shared player |
| Unlock audio when the button is pressed | Browsers allow the reply to play later | The player has to be created early, before any reply exists |
| Browser voice as the fallback | Relay still talks when Groq's limit is hit | Robotic voice; the orb's movement is simulated, not measured |
| Short memory: the last 3 questions and answers | Follow-up questions work | Bigger requests; the server must check the history so it can't be faked |
| Ignore presses while Relay is busy | Simple, no overlapping turns | You can't interrupt yet (Day 5) |
| Canvas drawing read from refs, not React state | Smooth 60fps animation, no React slowdown | Drawing code is more manual |

### The slowest step

**Groq Orpheus making the first piece of speech:** about **2.6 seconds** for one sentence in testing. Speech is heavy work, the model makes the whole clip before sending it, and it can't start until the first sentence of the answer is complete. Next comes the answer's start-up, about **2 seconds** before the first word, mostly queueing and start-up at Groq. Together, it takes about **5–6 seconds** from letting go to hearing Relay. Sending the first sentence alone is what keeps this from being longer.
