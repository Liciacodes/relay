import "server-only";

import { Redis } from "@upstash/redis";

/** The demo's limits. Full mode (your password) has none. Change them here. */
export const LIMITS = {
  questionsPerVisitor: 10, // per day
  questionsTotal: 40, // per day, all demo visitors together (Groq's free tier: ~200K tokens/day)
  transcriptionsPerVisitor: 15, // per day (a few retries for "didn't catch that")
  transcriptionsTotal: 60, // per day
  voiceClipsTotal: 60, // Orpheus clips per day; after that the browser's voice speaks
  unlockTries: 5, // wrong-or-right password attempts per visitor…
  unlockWindowS: 15 * 60, // …every 15 minutes
};

const DAY_S = 24 * 60 * 60;

// Online, Relay runs on many short-lived servers, so counts must live somewhere shared:
// Upstash Redis (added from Vercel's Storage tab, which sets these variables). On your
// own computer, without them, counts are kept in memory.
const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;
const memory = new Map<string, { count: number; until: number }>();

/**
 * Count one use of `name`. Returns false when that goes over `max` within the current
 * window (a calendar day in UTC by default). Counts reset when the window ends.
 */
export async function take(name: string, max: number, windowS = DAY_S): Promise<boolean> {
  const window = Math.floor(Date.now() / 1000 / windowS);
  const key = `relay:${name}:${window}`;
  try {
    if (redis) {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, windowS);
      return count <= max;
    }
  } catch (error) {
    // If the counter store is down, keep the demo working; Groq's own limits still apply.
    console.error("[limits]", error instanceof Error ? error.message : error);
    return true;
  }
  const now = Date.now();
  const entry = memory.get(key);
  const count = entry && entry.until > now ? entry.count + 1 : 1;
  memory.set(key, { count, until: (window + 1) * windowS * 1000 });
  return count <= max;
}
