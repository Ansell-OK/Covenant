// policy-compiler/src/compile.ts
// Main compile() function — tries providers in order: Gemini → Groq → local-rules.
//
// The LLM providers are optional and purely additive:
//   - If neither GEMINI_API_KEY nor GROQ_API_KEY is set, local-rules is used directly.
//   - If an API key is set but the provider fails (rate limit, invalid key, bad output),
//     falls back to the next provider automatically.
//   - local-rules is always the final fallback and is guaranteed to produce a valid PolicySpec.
//
// The LLM never executes a transaction and its output is always schema-validated
// before use. If the schema validation fails, the compiler falls through to local-rules.

import { PolicySpec } from "@covenant/core";
import { compileLocalRules, LocalRulesWarning } from "./providers/local-rules";
import { compileWithGemini } from "./providers/gemini";
import { compileWithGroq } from "./providers/groq";

export interface CompileResult {
  policy: PolicySpec;
  provider: "gemini" | "groq" | "local-rules";
  usedFallback: boolean;
  warnings: LocalRulesWarning[];
  fallbackReason?: string;
}

/**
 * Compile a plain-English policy description into a validated PolicySpec.
 *
 * Provider priority:
 *   1. Gemini (if GEMINI_API_KEY is set)
 *   2. Groq   (if GROQ_API_KEY is set)
 *   3. local-rules (always available, zero cost)
 *
 * @param text - Plain-English policy description
 * @param policyName - Name for the resulting PolicySpec (default: "compiled-policy")
 * @param options - Override API keys for testing
 */
export async function compile(
  text: string,
  policyName = "compiled-policy",
  options?: {
    geminiApiKey?: string;
    groqApiKey?: string;
  }
): Promise<CompileResult> {
  const geminiKey =
    options?.geminiApiKey ?? process.env.GEMINI_API_KEY ?? process.env.NEXT_PUBLIC_GEMINI_API_KEY ?? "";
  const groqKey =
    options?.groqApiKey ?? process.env.GROQ_API_KEY ?? process.env.NEXT_PUBLIC_GROQ_API_KEY ?? "";

  // ── Try Gemini ──────────────────────────────────────────────────────────
  if (geminiKey) {
    const result = await compileWithGemini(text, policyName, geminiKey);
    if (!result.usedFallback && result.policy) {
      return {
        policy: result.policy,
        provider: "gemini",
        usedFallback: false,
        warnings: [],
      };
    }
    // Gemini failed or fell back — try Groq next
    if (groqKey) {
      const groqResult = await compileWithGroq(text, policyName, groqKey);
      if (!groqResult.usedFallback && groqResult.policy) {
        return {
          policy: groqResult.policy,
          provider: "groq",
          usedFallback: false,
          warnings: [],
          fallbackReason: result.error,
        };
      }
      // Both failed — use local-rules
      const { policy, warnings } = compileLocalRules(text, policyName);
      return {
        policy,
        provider: "local-rules",
        usedFallback: true,
        warnings,
        fallbackReason:
          result.error ?? groqResult.error ?? "AI parse failed, used rule-based fallback",
      };
    }
    // Only Gemini key set, it failed — use local-rules
    const { policy, warnings } = compileLocalRules(text, policyName);
    return {
      policy,
      provider: "local-rules",
      usedFallback: true,
      warnings,
      fallbackReason: result.error ?? "Gemini failed, used rule-based fallback",
    };
  }

  // ── Try Groq (no Gemini key) ────────────────────────────────────────────
  if (groqKey) {
    const result = await compileWithGroq(text, policyName, groqKey);
    if (!result.usedFallback && result.policy) {
      return {
        policy: result.policy,
        provider: "groq",
        usedFallback: false,
        warnings: [],
      };
    }
    // Groq failed — use local-rules
    const { policy, warnings } = compileLocalRules(text, policyName);
    return {
      policy,
      provider: "local-rules",
      usedFallback: true,
      warnings,
      fallbackReason: result.error ?? "Groq failed, used rule-based fallback",
    };
  }

  // ── No API keys set — use local-rules directly ─────────────────────────
  const { policy, warnings } = compileLocalRules(text, policyName);
  return {
    policy,
    provider: "local-rules",
    usedFallback: false,
    warnings,
  };
}

export { compileLocalRules } from "./providers/local-rules";
export type { LocalRulesWarning } from "./providers/local-rules";
