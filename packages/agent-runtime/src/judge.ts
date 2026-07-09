// packages/agent-runtime/src/judge.ts
//
// The agent's core judgment: given current vault state and behavior signals,
// should a new cycle run right now, or is there nothing to do this tick?
//
// This is DELIBERATELY separate from the polling loop (poll.ts) and from
// execution (which reuses executeDepositCycle from @covenant/flowvault-adapter
// unchanged). Test this function in isolation before trusting the scheduler.
//
// The LLM only ever produces a judgment (should-act: true/false + a short
// reason), never executes anything and never invents a RoutingPlan itself.
// The actual plan still comes from engine() - the same deterministic function
// proven by 14 passing tests. If the LLM call fails, times out, or returns
// something that doesn't parse, the local-rules fallback below runs instead -
// the agent should NEVER silently stall because an API call failed.

import type { PolicySpec, BehaviorSignals } from "@covenant/core";

export interface VaultSnapshot {
  currentBlock: number;
  unlockedBalance: string;
  lockedBalance: string;
  lockUntilBlock: number;
}

export interface JudgmentResult {
  shouldAct: boolean;
  reason: string;
  provider: "llm" | "local-rules";
  usedFallback: boolean;
  fallbackReason?: string;
}

// ── Local-rules fallback: deterministic, zero-cost, always available ────────
function localRulesJudge(
  snapshot: VaultSnapshot,
  signals: BehaviorSignals,
  policy: PolicySpec
): JudgmentResult {
  // Design decision (deliberate): the agent is CONSERVATIVE.
  // FlowVault's own contract automatically transitions locked funds to
  // unlocked once lockUntilBlock passes - the agent does not treat idle
  // unlocked funds as something to act on. Once funds are unlocked, they
  // stay liquid until a human explicitly deposits/re-locks again, or until
  // a genuine behavior signal (an early withdraw, a fresh honored-lock
  // streak) gives the agent a real reason to propose a new cycle. This
  // avoids the agent ever moving funds based on its own assumption about
  // what the user "should" want, rather than something they actually did.

  if (signals.consecutiveEarlyWithdraws > 0 || signals.consecutiveHonoredLocks > 0) {
    return {
      shouldAct: true,
      reason: `Behavior signal active (early withdraws: ${signals.consecutiveEarlyWithdraws}, honored locks: ${signals.consecutiveHonoredLocks}) - re-evaluating routing plan.`,
      provider: "local-rules",
      usedFallback: false,
    };
  }

  return {
    shouldAct: false,
    reason: "No fresh behavior signal - nothing to act on this tick. Idle unlocked funds are left as-is; the agent does not proactively re-lock without an explicit trigger.",
    provider: "local-rules",
    usedFallback: false,
  };
}

// ── LLM judgment: optional, richer reasoning, same inputs ───────────────────
async function llmJudge(
  snapshot: VaultSnapshot,
  signals: BehaviorSignals,
  policy: PolicySpec
): Promise<JudgmentResult> {
  const prompt = `You are a monitoring judgment layer for a FlowVault vesting agent.
You do NOT decide the routing plan - a separate deterministic engine does that.

IMPORTANT design principle: this agent is CONSERVATIVE. FlowVault's own
contract automatically unlocks funds once a lock matures - you do not need
to detect or react to that transition. Idle unlocked funds are NOT, by
themselves, a reason to act - they stay liquid until a human explicitly
deposits again, or until a genuine behavior signal (an early withdraw, a
fresh honored-lock streak) gives a real reason to propose a new cycle.

Your ONLY job: given the vault snapshot and behavior signals below, should a
new routing cycle run right now, or is there nothing meaningfully new to act
on? Only recommend acting if a behavior signal is genuinely fresh/active -
never simply because funds are unlocked and sitting idle.

Vault snapshot: ${JSON.stringify(snapshot)}
Behavior signals: ${JSON.stringify(signals)}
Policy name: ${policy.name}

Respond with ONLY a JSON object, no other text: {"shouldAct": boolean, "reason": "one sentence"}`;

  const geminiKey = process.env.GEMINI_API_KEY;
  const groqKey = process.env.GROQ_API_KEY;

  if (!geminiKey && !groqKey) {
    throw new Error("No LLM provider configured (GEMINI_API_KEY / GROQ_API_KEY unset).");
  }

  if (groqKey) {
    const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${groqKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`Groq request failed: ${res.status}`);
    const data = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const text = data?.choices?.[0]?.message?.content ?? "";
    const parsed = JSON.parse(text.trim());
    if (typeof parsed.shouldAct !== "boolean" || typeof parsed.reason !== "string") {
      throw new Error("LLM response did not match expected shape.");
    }
    return { shouldAct: parsed.shouldAct, reason: parsed.reason, provider: "llm", usedFallback: false };
  }

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${geminiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { responseMimeType: "application/json" },
      }),
      signal: AbortSignal.timeout(10_000),
    }
  );
  if (!res.ok) throw new Error(`Gemini request failed: ${res.status}`);
  const data = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  const parsed = JSON.parse(text.trim());
  if (typeof parsed.shouldAct !== "boolean" || typeof parsed.reason !== "string") {
    throw new Error("LLM response did not match expected shape.");
  }
  return { shouldAct: parsed.shouldAct, reason: parsed.reason, provider: "llm", usedFallback: false };
}

// ── Public entry point: try LLM, fall back to local-rules on ANY failure ───
export async function judge(
  snapshot: VaultSnapshot,
  signals: BehaviorSignals,
  policy: PolicySpec
): Promise<JudgmentResult> {
  const hasLlmKey = Boolean(process.env.GEMINI_API_KEY || process.env.GROQ_API_KEY);
  if (!hasLlmKey) {
    return localRulesJudge(snapshot, signals, policy);
  }

  try {
    return await llmJudge(snapshot, signals, policy);
  } catch (err) {
    const fallback = localRulesJudge(snapshot, signals, policy);
    return {
      ...fallback,
      usedFallback: true,
      fallbackReason: `LLM judgment failed (${err instanceof Error ? err.message : String(err)}), used local-rules instead.`,
    };
  }
}