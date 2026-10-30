import "server-only";

import type { Turn } from "@/lib/audio/types";
import type { ReplyEvent } from "@/lib/evidence";
import { evidenceFrom, rankEvidence, type Lookup } from "./evidence";
import type { Mode } from "./access";
import { myLogin } from "./github";
import { GroqError, streamChatRound, type ChatEvent, type ChatMessage, type PromptContext, type ToolCall } from "./groq";
import { runTool, toolsFor } from "./tools";
import { myRepos } from "./tools/listMyRepos";

const MAX_ROUNDS = 4; // at most 3 tool calls, then the model must answer

/**
 * The tool loop. Yields events for the browser as they happen: a `step` after each tool,
 * `text` pieces of the answer, and finally the ranked `evidence` (if any tool ran).
 *
 * This is an "async generator" (`async function*`): instead of returning one value at the
 * end, it hands out values one at a time with `yield`, whenever they're ready.
 *
 * Each round, the model either answers (we pass its words on) or asks for a tool. Then we
 * run the tool, add the call and its result to the conversation, and ask again.
 */
export async function* answerQuestion(conversation: Turn[], apiKey: string, mode: Mode): AsyncGenerator<ReplyEvent> {
  const messages: ChatMessage[] = [...conversation];
  const lookups: Lookup[] = []; // the cards each tool produced, in the order they ran
  let answer = "";
  const started = performance.now();
  const since = () => Math.round(performance.now() - started); // for the [timing] lines
  // Your repo names, for the system prompt (cached for 5 minutes, usually instant). If
  // GitHub can't be reached, the model falls back to calling list_my_repos itself.
  // In the demo, only public repos are named, and Relay talks about their owner by name.
  const [repos, owner] = await Promise.all([
    myRepos(mode).then((list) => list.map((repo) => repo.name), () => []),
    mode === "demo" ? myLogin().catch(() => "the owner") : null,
  ]);
  if (since() > 50) console.log(`[timing] repo list fetched: ${since()}ms`);
  const prompt: PromptContext = { repos, demoOwner: owner };

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const lastRound = round === MAX_ROUNDS;
    const roundStart = since();
    // `yield*` passes on every event from the round, then gives us its result.
    const { text, call, firstByte, firstText } = yield* oneRound(messages, apiKey, {
      toolChoice: lastRound ? "none" : "auto",
      mode,
      prompt,
      since,
    });
    answer += text;
    // Times in ms since the question reached the server. Watch them in the `npm run dev` terminal.
    console.log(
      `[timing] round ${round}: started ${roundStart}, first byte ${firstByte}` +
        (firstText === null ? "" : `, first text ${firstText}`) +
        `, done ${since()}` +
        (call ? ` → ${call.name}` : " → answered"),
    );
    if (!call) break; // the model answered: done

    const run = await runTool(call.name, call.arguments, mode);
    yield { type: "step", ...run.step };
    // A drafted issue goes to the browser as a card. Nothing is created until you Confirm.
    if (call.name === "propose_issue" && run.step.ok) {
      const { repo, title, body } = run.result as { repo: string; title: string; body: string };
      yield { type: "draft", draft: { repo, title, body } };
    }
    lookups.push({ tool: call.name, ok: run.step.ok, items: evidenceFrom(call.name, run.result) });

    messages.push(
      {
        role: "assistant",
        content: text,
        tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }],
      },
      { role: "tool", tool_call_id: call.id, content: run.json },
    );
  }

  const items = rankEvidence(lookups, answer);
  if (items.length > 0) yield { type: "evidence", items };
}

/** One streamed round. Retries once if the model wrote a broken tool call. */
async function* oneRound(
  messages: ChatMessage[],
  apiKey: string,
  {
    toolChoice,
    mode,
    prompt,
    since,
  }: { toolChoice: "auto" | "none"; mode: Mode; prompt: PromptContext; since: () => number },
): AsyncGenerator<ReplyEvent, { text: string; call: ToolCall | null; firstByte: number; firstText: number | null }> {
  for (let attempt = 1; ; attempt++) {
    let text = "";
    let call: ToolCall | null = null;
    let firstText: number | null = null;
    try {
      const events = await streamChatRound(messages, apiKey, { tools: toolsFor(mode), toolChoice, prompt });
      const firstByte = since(); // Groq answered (headers in); the stream follows
      for await (const event of eventsOf(events)) {
        if (event.type === "text") {
          firstText ??= since();
          text += event.text;
          yield { type: "text", text: event.text };
        } else {
          call ??= event.call; // gpt-oss makes one call at a time; keep the first
        }
      }
      return { text, call, firstByte, firstText };
    } catch (error) {
      // gpt-oss sometimes writes a tool call Groq can't read ("tool_use_failed").
      const broken = error instanceof GroqError && error.groqCode === "tool_use_failed";
      if (broken && attempt === 1 && !text) continue;
      throw error;
    }
  }
}

/** Read a stream one event at a time, so `for await` can loop over it. */
async function* eventsOf(stream: ReadableStream<ChatEvent>) {
  const reader = stream.getReader();
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return;
      yield value;
    }
  } finally {
    reader.releaseLock();
  }
}
