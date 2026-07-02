// policy-compiler/src/providers/groq.ts
// Optional Groq provider for English -> PolicySpec compilation.
//
// Uses OpenAI-compatible endpoint at https://api.groq.com/openai/v1.
// Sign up at https://console.groq.com — no credit card required.
// Free tier covers all models (Llama, Qwen, etc.) gated by rate limits.
//
// IMPORTANT: Verify current per-model rate limits at
// https://console.groq.com/docs/rate-limits before demoing.
// These are set per model and have changed. Do NOT hardcode RPM/RPD.
//
// The OpenAI-compatible API means this same pattern works for any
// OpenRouter :free model or other compatible provider — just swap baseURL.
//
// Rate limits: implement generic 429-aware backoff only.
// On any error: fall back to local-rules.

import OpenAI from "openai";
import { PolicySpec, PolicySpecSchema } from "@covenant/core";
import { compileLocalRules } from "./local-rules";

// Model selection: use a Groq-hosted free-tier model.
// Verify current model list at https://console.groq.com/docs/models
const GROQ_MODEL = "llama-3.3-70b-versatile";
const GROQ_BASE_URL = "https://api.groq.com/openai/v1";

const POLICY_SYSTEM_PROMPT = `You are a financial policy compiler. Convert the user's plain-English vault policy into a valid JSON PolicySpec object.

The PolicySpec schema:
{
  name: string,
  baseline: {
    lockPercent: number (0-100, % of deposit to lock),
    lockDurationBlocks: number (positive int, Stacks blocks; 1 day ≈ 144 blocks),
    splitAddress: string | null (STX/SP address or null),
    splitPercent: number (0-100, % of deposit to split to splitAddress)
  },
  adjustments: Array<{
    when: "early_withdraw_streak" | "honored_lock_streak" | "deposit_cadence_broken" | "outflow_velocity_spike",
    thresholdCount?: number (positive int),
    thresholdWindowBlocks?: number (positive int),
    effect: {
      lockPercentDelta: number,
      lockDurationDeltaBlocks: number,
      splitPercentDelta?: number
    },
    decay: "reset_on_opposite" | "permanent" | "expires_after_n_cycles",
    decayCycles?: number (required if decay is "expires_after_n_cycles")
  }>,
  bounds: {
    minLockPercent: number,
    maxLockPercent: number,
    minLockDurationBlocks: number,
    maxLockDurationBlocks: number
  }
}

Rules:
- lockPercent + splitPercent must never exceed 100
- 1 day ≈ 144 blocks, 1 week ≈ 1008, 1 month ≈ 4320, 1 year ≈ 52560
- Return ONLY the raw JSON object. No markdown, no explanation, no code fences.
- If no split address is provided but a split percent is mentioned, set splitAddress to null`;

export interface GroqResult {
  policy: PolicySpec | null;
  usedFallback: boolean;
  error?: string;
}

/**
 * Compile English policy text using the Groq API (OpenAI-compatible).
 * Falls back to local-rules on any error.
 *
 * @param text - Plain-English policy description
 * @param policyName - Name for the resulting PolicySpec
 * @param apiKey - Groq API key (from GROQ_API_KEY env var)
 */
export async function compileWithGroq(
  text: string,
  policyName: string,
  apiKey: string
): Promise<GroqResult> {
  const client = new OpenAI({
    baseURL: GROQ_BASE_URL,
    apiKey,
  });

  let lastError: string | undefined;

  // Generic 429-aware backoff: try up to 2 times with exponential backoff
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const completion = await client.chat.completions.create({
        model: GROQ_MODEL,
        messages: [
          { role: "system", content: POLICY_SYSTEM_PROMPT },
          {
            role: "user",
            content: `Convert this policy to JSON:\n\n${text}`,
          },
        ],
        response_format: { type: "json_object" },
        temperature: 0,
      });

      const rawText = completion.choices[0]?.message?.content ?? "";
      const parsed = JSON.parse(rawText);
      parsed.name = policyName;

      // Validate against schema — never trust LLM output without validation
      const validated = PolicySpecSchema.parse(parsed);
      return { policy: validated, usedFallback: false };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      lastError = errMsg;

      // Handle rate limit with backoff
      if (
        errMsg.includes("429") ||
        errMsg.includes("rate_limit") ||
        errMsg.includes("Rate limit")
      ) {
        const waitMs = Math.pow(2, attempt) * 1000;
        await sleep(waitMs);
        continue;
      }

      // Any other error: break and fall back
      break;
    }
  }

  // Fall back to local-rules
  const { policy: fallbackPolicy } = compileLocalRules(text, policyName);
  return {
    policy: fallbackPolicy,
    usedFallback: true,
    error: `AI parse failed (${lastError ?? "unknown error"}), used rule-based fallback`,
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
