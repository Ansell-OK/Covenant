// policy-compiler/src/providers/gemini.ts
// Optional Gemini provider for English -> PolicySpec compilation.
//
// Uses the free tier (Flash model family) from Google AI Studio.
// Sign up at https://aistudio.google.com — no credit card required.
//
// IMPORTANT: Verify current free-tier model availability at
// https://ai.google.dev/gemini-api/docs/pricing before hardcoding a model name.
// Google has changed free-tier model access multiple times. As of this writing,
// the Flash and Flash-Lite families are free (e.g. gemini-2.5-flash-lite).
// Pro-tier models require paid billing.
//
// Rate limits: implement generic 429-aware backoff only (never hardcode RPM/RPD).
// On any error: fall back to local-rules, surface "AI parse failed, used rule-based fallback".

import { GoogleGenAI } from "@google/genai";
import { PolicySpec, PolicySpecSchema } from "@covenant/core";
import { compileLocalRules } from "./local-rules";

const GEMINI_MODEL = "gemini-2.5-flash-lite"; // free-tier model; verify at ai.google.dev/gemini-api/docs/pricing

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
    decayCycles?: number (required if decay === "expires_after_n_cycles")
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
- All amounts in blocks (1 day ≈ 144 blocks, 1 week ≈ 1008, 1 month ≈ 4320, 1 year ≈ 52560)
- ALWAYS include bounds exactly as: { "minLockPercent": 0, "maxLockPercent": 90, "minLockDurationBlocks": 144, "maxLockDurationBlocks": 52560 }
- NEVER omit lockDurationDeltaBlocks or lockPercentDelta in the effect object. Use 0 if there is no change.
- Return ONLY valid JSON, no explanation
- If no split address is provided but a split percent is mentioned, set splitAddress: null`;

export interface GeminiResult {
  policy: PolicySpec | null;
  usedFallback: boolean;
  error?: string;
}

/**
 * Compile English policy text using the Gemini API.
 * Falls back to local-rules on any error.
 *
 * @param text - Plain-English policy description
 * @param policyName - Name for the resulting PolicySpec
 * @param apiKey - Gemini API key (from GEMINI_API_KEY env var)
 */
export async function compileWithGemini(
  text: string,
  policyName: string,
  apiKey: string
): Promise<GeminiResult> {
  const ai = new GoogleGenAI({ apiKey });

  let lastError: string | undefined;

  // Generic 429-aware backoff: try up to 2 times with exponential backoff
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: GEMINI_MODEL,
        contents: [
          {
            role: "user",
            parts: [{ text: `Convert this policy to JSON:\n\n${text}` }],
          },
        ],
        config: {
          systemInstruction: POLICY_SYSTEM_PROMPT,
          responseMimeType: "application/json",
        },
      });

      const rawText = response.text ?? "";
      const parsed = JSON.parse(rawText);
      parsed.name = policyName;

      // Gracefully patch missing LLM fields before strict Zod validation
      if (!parsed.bounds || typeof parsed.bounds !== "object" || parsed.bounds.minLockDurationBlocks === 0) {
        parsed.bounds = {
          minLockPercent: 0,
          maxLockPercent: 90,
          minLockDurationBlocks: 144,
          maxLockDurationBlocks: 52560
        };
      }
      if (Array.isArray(parsed.adjustments)) {
        for (const adj of parsed.adjustments) {
          if (adj && typeof adj === "object") {
            if (!adj.effect) adj.effect = {};
            if (adj.effect.lockDurationDeltaBlocks === undefined || adj.effect.lockDurationDeltaBlocks === null) adj.effect.lockDurationDeltaBlocks = 0;
            if (adj.effect.lockPercentDelta === undefined || adj.effect.lockPercentDelta === null) adj.effect.lockPercentDelta = 0;
            if (adj.decayCycles === null) delete adj.decayCycles;
            if (adj.thresholdCount === null) delete adj.thresholdCount;
            if (adj.thresholdWindowBlocks === null) delete adj.thresholdWindowBlocks;
          }
        }
      }

      // Validate against schema — never trust LLM output without validation
      const validated = PolicySpecSchema.parse(parsed);
      return { policy: validated, usedFallback: false };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      lastError = errMsg;

      // Handle rate limit (429) with backoff
      if (errMsg.includes("429") || errMsg.includes("RESOURCE_EXHAUSTED")) {
        const waitMs = Math.pow(2, attempt) * 1000;
        await sleep(waitMs);
        continue;
      }

      // Any other error: break and fall back immediately
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
