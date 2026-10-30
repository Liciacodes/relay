# Relay

Relay is a voice assistant for your GitHub. You ask it a question out loud, it answers out loud, and it shows the evidence behind every claim it makes.

![Relay demo](./docs/demo.gif)

**Live demo:** https://relay-one-rosy.vercel.app

The public demo runs on my own GitHub: public repos only, read-only, with small daily limits. Hold the Space bar (or the button), ask something like "What did Liciacodes commit to reviewpal this week?", then let go.

## What it can do

- **Hold to talk.** Hold Space or the button, speak, let go. A live waveform shows the mic is hearing you.
- **Spoken answers that stream.** The answer appears word by word, and Relay starts speaking before the whole answer is written.
- **GitHub tools.** Relay can list repos and look up recent commits, pull requests (open or merged) and open issues.
- **Evidence cards.** Under each answer are links to the commits, PRs, issues or repos the answer is based on, most relevant first.
- **A timeline of the steps, with real times.** It shows each step and its measured time, for example "Heard you 1.0s · Checked commits in relay 0.7s · First word 3.4s · Started speaking 4.1s".
- **Issues are created only after you confirm.** Relay can draft an issue, but nothing reaches GitHub until you press Confirm on the draft card.
- **Interrupt anytime.** Hold Space while Relay is thinking or speaking to cut it off and ask something else. Esc just stops it.

## How it works

```
Browser                          Next.js API routes (server)             Services
-------                          ---------------------------             --------
hold to talk  -- audio -------->  /api/transcribe  --------------------> Groq Whisper
              <- text ---------
question      ----------------->  /api/reply  -- tool loop ------------> Groq gpt-oss-20b
              <- NDJSON stream --                  `-- tools (GET only) -> GitHub REST API
speech chunks ----------------->  /api/speak  -------------------------> Groq Orpheus (TTS)
              <- WAV audio -----
Confirm       ----------------->  /api/issues  (the only write) -------> GitHub (create issue)
```

**Tool calling:** the model doesn't know anything about my GitHub on its own. Instead it asks for a tool, for example `recent_commits(repo: "relay", since: "2026-10-01")`. The server runs that tool against the GitHub API and sends back a small, trimmed result, with a URL for every item. The model can do this for up to three lookups before it has to answer.

**NDJSON streaming:** `/api/reply` streams one JSON object per line. There are separate lines for each finished tool step, each piece of the answer text, the evidence cards, an issue draft, or an error. This means the timeline, the text and the cards all arrive over a single response, as they happen.

## Decisions and trade-offs

- **Keys stay on the server.** The Groq key and GitHub token are only used in server code. The browser never sees them; it only talks to my own API routes.
- **The AI can only draft; I confirm writes.** The model's only issue tool is `propose_issue`, which returns a draft and creates nothing. The single route that writes to GitHub runs only when a person clicks Confirm, and it checks the input again on the server.
- **Demo rules are enforced on the server.** In the public demo, the server leaves out private repos, removes the drafting tool and refuses the write route. The page only displays which mode you're in. My own password unlocks full mode with a signed, HTTP-only cookie.
- **Redis for limits.** On Vercel, each request can land on a different short-lived function, and they don't share memory, so in-memory counters would reset. The daily limits are kept in Upstash Redis instead. Visitors are counted by a hash of their IP address, never the address itself.
- **Browser voice fallback.** Groq's Orpheus voice has a small free daily limit. When it's reached, or fails, the answer is read by the browser's built-in voice instead, so you still hear an answer.

## Performance

Relay used to take 6 to 9 seconds to start speaking after you let go. Before changing anything, I added timing to every stage: transcription, each model round, each GitHub lookup, the first text, the first speech request and the first sound. Then I ran the same 5 spoken questions through the real pipeline.

Time from letting go to the first sound:

| Question | Before | After |
|---|---|---|
| What did I commit to reviewpal this week? | 8.9s | 5.4s |
| What did I commit this month? | 6.0s | 4.4s |
| Are there any open pull requests in relay? | 6.9s | 4.1s |
| What are the open issues in reviewpal? | 3.8s (wrong answer) | 4.1s |
| Which of my repos did I push to most recently? | 3.4s | 3.3s |
| **Average** | **5.8s** | **4.3s** |

The measurements showed that most of the time went on extra model rounds and GitHub lookups, not on the voice. In the slowest case, the speech recognition heard "ReviewPol", so the model looked up a repo that doesn't exist, listed my repos, then tried again: four rounds. The fixes:

- My repo names are cached for 5 minutes and included in the model's instructions. The model can pick the right repo straight away, and match a misheard name to the real one.
- The same names are passed to Whisper as a spelling hint.
- The first spoken chunk is kept short. Orpheus took 0.5 to 1 second for a short sentence and 2.4 seconds for a 170-character one.

Question 4 got slightly slower but now gives the right answer; before, it said the repo couldn't be found. The timing logs are still in the code (`[timing]` lines in the server terminal).

## Accuracy

In one test, Relay summarised my commits in the wrong order: it split one commit into two and skipped another. The evidence cards under the answer showed the real commits, so the mistake was easy to see. I fixed it on both sides:
- The commit tool now numbers each commit and states that the list is newest first, and that one item is exactly one commit.
- The instructions tell the model to keep that order, never split or merge items, and mention every one when there are five or fewer.

The same question then gave the right list in every run I tried.

## Run it locally

You need Node.js 20 or later, a [Groq API key](https://console.groq.com/keys) and a GitHub fine-grained token.

```bash
npm install
cp .env.local.example .env.local
npm run dev        # http://localhost:3000
```

Then fill in `.env.local`:

| Variable | What it's for |
|---|---|
| `GROQ_API_KEY` | Whisper, gpt-oss-20b and Orpheus. |
| `GITHUB_TOKEN` | A fine-grained token: Metadata, Contents and Pull requests read-only; Issues read and write (only used when you confirm a draft). |
| `RELAY_PASSWORD` | Optional. Leave it empty locally to always be in full mode. Online, it unlocks full mode. |
| `KV_REST_API_URL`, `KV_REST_API_TOKEN` | Optional. Upstash Redis for the demo's daily limits. Without them, the counts are kept in memory. |

Orpheus needs its terms accepted once in the Groq console; until then, Relay uses the browser's voice. To check the code: `npm run lint && npx tsc --noEmit`.

## Built with

Next.js (App Router), TypeScript, Tailwind CSS, the Web Audio API, Groq (Whisper, gpt-oss-20b, Orpheus), the GitHub REST API, Upstash Redis and Vercel.
