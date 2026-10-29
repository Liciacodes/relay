import "server-only";

import type { Turn } from "@/lib/audio/types";
import { GroqError, streamChatRound, type ChatEvent, type ChatMessage, type ToolCall } from "./groq";
import { TOOLS, runTool } from "./tools";

const MAX_ROUNDS = 4; // at most 3 tool calls, then the model must answer

/**
 * The tool loop. Yields the answer's text pieces as they're written.
 *
 * This is an "async generator" (`async function*`): instead of returning one value at the
 * end, it hands out values one at a time with `yield`, whenever they're ready.
 *
 * Each round, the model either answers (we pass its words on) or asks for a tool. Then we
 * run the tool, add the call and its result to the conversation, and ask again.
 */
export async function* answerQuestion(conversation: Turn[], apiKey: string): AsyncGenerator<string> {
  const messages: ChatMessage[] = [...conversation];

  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const lastRound = round === MAX_ROUNDS;
    // `yield*` passes on every text piece from the round, then gives us its result.
    const { text, call } = yield* oneRound(messages, apiKey, lastRound ? "none" : "auto");
    if (!call) return; // the model answered: done

    messages.push(
      {
        role: "assistant",
        content: text,
        tool_calls: [{ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } }],
      },
      { role: "tool", tool_call_id: call.id, content: await runTool(call.name, call.arguments) },
    );
  }
}

/** One streamed round. Retries once if the model wrote a broken tool call. */
async function* oneRound(
  messages: ChatMessage[],
  apiKey: string,
  toolChoice: "auto" | "none",
): AsyncGenerator<string, { text: string; call: ToolCall | null }> {
  for (let attempt = 1; ; attempt++) {
    let text = "";
    let call: ToolCall | null = null;
    try {
      const events = await streamChatRound(messages, apiKey, { tools: TOOLS, toolChoice });
      for await (const event of eventsOf(events)) {
        if (event.type === "text") {
          text += event.text;
          yield event.text;
        } else {
          call ??= event.call; // gpt-oss makes one call at a time; keep the first
        }
      }
      return { text, call };
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
