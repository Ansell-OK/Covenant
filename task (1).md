# TASK: Build "Covenant" — a Behavioral Vesting Engine for FlowVault, with an English Policy Compiler

## 0. Context you must internalize before writing code

This is a submission for the FlowVault Builder Bounty ($1,000 USDT pool, Stacks testnet).
Judging weights: **Innovation & Design 35% | FlowVault Integration depth 30% | Technical Execution 20% | Ecosystem Value 15%**.

Explicitly NOT eligible (do not build any of these):
- generic dashboards, wallet wrappers, UI clones of the official demo apps (`savings.flow-vault.dev`, `flowpay.flow-vault.dev`)
- simple deposit forms / basic CRUD
- anything with little or no routing logic

Explicitly rewarded: financial behavior design, automation, programmable routing, composability, reusable integrations. The bounty page flags "AI treasury agents" and "event-triggered unlocks" as High Innovation Potential.

**Why this idea and not the obvious ones.** FlowVault's contract is intentionally simple: one lock rule and one split rule per principal, static until you call `setRoutingRules` again. That's a strength (auditable, safe) but it means the contract has zero concept of history — it can't know if you withdrew the second funds unlocked last time, or if you've been depositing consistently, or if a counterparty has been reliable. A "lock 80%, split 20%" demo app (what most submissions will be) just calls that static rule once and stops. That is explicitly what the bounty says NOT to build.

**Product thesis.** Build the thing FlowVault's contract can't be — a stateful layer above it. Covenant watches on-chain behavior (deposit cadence, early-withdraw vs. honored-lock history, outflow velocity) and computes a new routing rule every cycle, re-issuing `setRoutingRules` so the vault's actual behavior changes over time based on what happened, not on a fixed schedule. One deterministic engine, four bounty categories (payroll/vesting, savings, treasury, creator revenue), because the mechanism (behavior to rule) is generic and the policy (what counts as "good behavior" and what the response is) is just config.

**Where the LLM fits, and where it deliberately does not.** The scoring/decision engine (`covenant-core`) is 100% deterministic, has no LLM dependency, and is what actually executes on-chain calls. It runs from a JSON `PolicySpec`. On top of that, an optional policy compiler takes plain English and converts it into a valid `PolicySpec`. If the LLM is unavailable, wrong, or rate-limited, `covenant-core` still works from a hand-written or default `PolicySpec` — the LLM only ever produces config, never executes a transaction, and its output is schema-validated before use. This is intentional: judges should trust the money-moving logic even if they distrust AI-generated code, and the demo can't fail live due to a rate limit.

## 1. Architecture

```
packages/
  covenant-core/            # pure TS, zero blockchain deps, zero LLM deps — the real IP
    src/policySpec.ts        # zod schema: the generic "behavior -> rule" config format (section 2)
    src/behaviorSignals.ts    # BehaviorSignals type + derivation from history log (section 3)
    src/routingPlan.ts        # RoutingPlan type: the engine's output, input to the adapter (section 4)
    src/engine.ts              # (BehaviorSignals, PolicySpec) -> RoutingPlan, pure function (section 5)
    src/history.ts             # HistoryLogEntry schema + append/read helpers (section 3)
    src/__tests__/             # table-driven tests: signals in, plan out, for every scenario in section 5
  policy-compiler/          # optional layer: English -> PolicySpec (section 7)
    src/compile.ts
    src/providers/local-rules.ts   # zero-cost default, no API key, keyword table in section 7
    src/providers/gemini.ts        # optional, free tier, section 8
    src/providers/groq.ts          # optional, free tier, section 8
  flowvault-adapter/        # the ONLY package that touches flowvault-sdk / @stacks/connect
    src/client.ts             # SDK init, both modes — verbatim code in section 6
    src/executor.ts           # takes a RoutingPlan from covenant-core, calls setRoutingRules/deposit/withdraw
  cli/                       # `npx covenant run --policy policy.json --address ST...`
  frontend/                  # Next.js UI — thin, calls the three packages above, no logic of its own
    src/lib/flowvault.ts
    src/hooks/useCovenant.ts
    src/app/
  tools/
    agent-tool-schema.json   # full body in section 9
  README.md
  DEMO.md
  submission/
    form-answers.md          # pre-filled bounty submission form, section 11
contracts-notes.md            # confirms use of existing deployed flowvault-v2, no redeploy
```

The package boundary is the point: `covenant-core` has no import of `flowvault-sdk` anywhere in it. It takes signals in, returns a `RoutingPlan` out, full stop.

## 2. `PolicySpec` schema (covenant-core/src/policySpec.ts)

```ts
import { z } from "zod";

export const PolicySpecSchema = z.object({
  name: z.string(),
  baseline: z.object({
    lockPercent: z.number().min(0).max(100),        // % of new deposit
    lockDurationBlocks: z.number().int().positive(),
    splitAddress: z.string().nullable(),              // STX/SP address, or null
    splitPercent: z.number().min(0).max(100),         // % of new deposit
  }),
  adjustments: z.array(z.object({
    when: z.enum([
      "early_withdraw_streak",
      "honored_lock_streak",
      "deposit_cadence_broken",
      "outflow_velocity_spike",
    ]),
    thresholdCount: z.number().int().positive().optional(),   // e.g. 2 consecutive early withdraws
    thresholdWindowBlocks: z.number().int().positive().optional(), // for velocity/cadence checks
    effect: z.object({
      lockPercentDelta: z.number(),        // applied to baseline, then clamped to bounds
      lockDurationDeltaBlocks: z.number(),
      splitPercentDelta: z.number().optional(),
    }),
    decay: z.enum(["reset_on_opposite", "permanent", "expires_after_n_cycles"]),
    decayCycles: z.number().int().positive().optional(), // required when decay === "expires_after_n_cycles"
  })),
  bounds: z.object({
    minLockPercent: z.number().min(0).max(100),
    maxLockPercent: z.number().min(0).max(100),
    minLockDurationBlocks: z.number().int().positive(),
    maxLockDurationBlocks: z.number().int().positive(),
  }),
});

export type PolicySpec = z.infer<typeof PolicySpecSchema>;
```

Every use case in section 0 is the same engine with a different `PolicySpec` value — say this explicitly in the README and demo.

## 3. `BehaviorSignals` and history persistence (covenant-core/src/behaviorSignals.ts, history.ts)

**This is the second most important type in the system and was previously undefined — implement exactly this shape.**

```ts
// behaviorSignals.ts
export type BehaviorSignals = {
  address: string;
  asOfBlock: number;
  consecutiveEarlyWithdraws: number;   // resets to 0 on any honored (non-early) withdraw
  consecutiveHonoredLocks: number;     // resets to 0 on any early withdraw
  blocksSinceLastDeposit: number | null; // null if no prior deposit
  outflowLastWindow: {                 // sum of withdraws within a trailing window
    windowBlocks: number;
    totalMicroWithdrawn: string;       // bigint as string
    withdrawCount: number;
  };
  activeAdjustmentIds: string[];       // adjustment `when` values currently in effect, per decay rules
};
```

```ts
// history.ts
export type HistoryLogEntry = {
  address: string;
  blockHeight: number;
  timestampIso: string;
  eventType: "deposit" | "withdraw" | "setRoutingRules";
  amountMicro: string | null;          // bigint as string; null for setRoutingRules events
  wasEarlyWithdraw: boolean | null;     // for withdraw events: true if this withdraw drained locked
                                        // balance before that balance's own lockUntilBlock (read the
                                        // vault state's lock-until immediately before this withdraw
                                        // tx and compare to the withdraw tx's block height); null for
                                        // deposit/setRoutingRules events
  txId: string;
};

// deriveBehaviorSignals(entries: HistoryLogEntry[], currentBlock: number, policy: PolicySpec): BehaviorSignals
// Pure function: walks entries in chronological order, computes streaks/cadence/velocity.
// "Early withdraw" is defined ENTIRELY off-chain here — the contract has no such concept, it only
// enforces that locked balance cannot be withdrawn before lockUntilBlock at all. Covenant's
// definition: a withdraw counts as "early" if, at the time of that withdraw, the address still had
// ANY locked balance with a future lockUntilBlock per the routing rules active at that time (i.e.
// the user chose to withdraw their unlocked portion while a lock was still active/being honored is
# fine — NOT early; but if the policy's intent is stricter, e.g. "any withdraw before the full
// cycle completes counts", implement that as a configurable rule in the derivation function, and
// document which definition you chose in the README, since this is a design decision, not a fact
// pulled from the contract.
```

Persistence: implement `history.ts` to read/write `HistoryLogEntry[]` as a single JSON array. The **CLI** persists to a local file (e.g. `.covenant/history-<address>.json`). The **frontend** persists to browser storage in-memory/IndexedDB per the artifact storage constraints if built as an artifact, or a simple JSON file via a lightweight local API route if built as a standalone Next.js app — pick one and document it in the README; the two consumers do not need to share a physical store, only the same `HistoryLogEntry` schema, since each is demonstrating the engine independently. State resets on file deletion; this is expected and should be mentioned in DEMO.md as "resetting history for a clean demo run."

## 4. `RoutingPlan` — the engine's output (covenant-core/src/routingPlan.ts)

**Previously undefined — this is the exact seam between `covenant-core` (pure logic) and `flowvault-adapter` (SDK calls). Implement exactly this shape; the adapter's `executor.ts` should require nothing beyond this object plus a deposit amount to make its SDK calls.**

```ts
export type RoutingPlan = {
  splitAddress: string | null;
  splitAmountMicro: string;         // bigint as string, computed from splitPercent * depositAmount
  lockAmountMicro: string;          // bigint as string, computed from lockPercent * depositAmount
  lockUntilBlock: number;           // absolute block height = currentBlock + lockDurationBlocks
  rationale: string;                // <= 2 sentences, human-readable, shown in the UI's explain panel
  appliedAdjustmentIds: string[];   // which `when` values fired this cycle, for the audit log
};
```

The adapter converts this directly into the SDK's `setRoutingRules({ lockAmount, lockUntilBlock, splitAddress, splitAmount })` call — `lockAmountMicro`/`splitAmountMicro` map 1:1 to `lockAmount`/`splitAmount`, no further transformation needed. `covenant-core`'s engine must guarantee `BigInt(lockAmountMicro) + BigInt(splitAmountMicro) <= depositAmountMicro` before returning the plan — this is the client-side guard for the contract's deterministic-abort behavior described in the docs.

## 5. `covenant-core` engine — required test scenarios

`engine(signals: BehaviorSignals, policy: PolicySpec, depositAmountMicro: string, currentBlock: number): RoutingPlan`

Table-driven tests, each asserting the resulting `RoutingPlan`:

1. Fresh principal, no history (`consecutiveEarlyWithdraws: 0, consecutiveHonoredLocks: 0, blocksSinceLastDeposit: null`): baseline plan applied exactly, `appliedAdjustmentIds: []`.
2. `consecutiveEarlyWithdraws: 2` meeting an `early_withdraw_streak` adjustment's `thresholdCount: 2`: that adjustment's deltas applied, clamped to `bounds`, `appliedAdjustmentIds` includes it.
3. `consecutiveHonoredLocks: 3` meeting an `honored_lock_streak` adjustment's `thresholdCount: 3`: loosening effect applied.
4. Same as #2, but this cycle's signals show the streak just broke (`consecutiveEarlyWithdraws: 0` after a prior active adjustment with `decay: "reset_on_opposite"`): adjustment no longer applied, reverts to baseline.
5. `blocksSinceLastDeposit` greater than a `deposit_cadence_broken` adjustment's `thresholdWindowBlocks`: cadence adjustment applied.
6. `outflowLastWindow.totalMicroWithdrawn` exceeds a threshold you define alongside the `outflow_velocity_spike` adjustment's `thresholdWindowBlocks`/`thresholdCount` (document your exact trigger condition in a code comment, since the schema doesn't encode a raw amount threshold — treat `thresholdCount` as "number of withdraws within the window" for this `when` type): tightening effect applied.
7. Two adjustments both eligible simultaneously: deltas sum, then clamp to `bounds`, then assert `lockPercent + splitPercent <= 100` after clamping (if a combined result would exceed 100, reduce lockPercent first, document this priority rule in a comment).
8. Split-only policy (`baseline.lockPercent: 0`): engine still works, `lockAmountMicro: "0"`.
9. Lock-only policy (`splitPercent: 0, splitAddress: null`): engine still works, `splitAmountMicro: "0"`.
10. Hold-only baseline (`lockPercent: 0, splitPercent: 0`) with an `early_withdraw_streak` adjustment whose effect introduces lock (`lockPercentDelta: 40`) after `thresholdCount` is met: demonstrates hold as the true default state, with lock appearing only as a consequence of bad behavior.

## 6. FlowVault SDK — exact reference code (paste this, do not re-derive it)

Package: `flowvault-sdk@0.1.1`. Pin this exact version.

**Backend/CLI mode** (used only in `cli/`, never in `frontend/`):
```ts
import { FlowVault } from "flowvault-sdk";

const vault = new FlowVault({
  network: "testnet",
  contractAddress: "STD7QG84VQQ0C35SZM2EYTHZV4M8FQ0R7YNSQWPD",
  contractName: "flowvault-v2",
  tokenContractAddress: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
  tokenContractName: "usdcx",
  senderKey: process.env.STACKS_PRIVATE_KEY,
});
```

**Browser wallet mode** (used only in `frontend/`, this is the required mode per the docs' "never sender keys in browser" rule):
```ts
import { request } from "@stacks/connect";
import { FlowVault } from "flowvault-sdk";

const walletVault = new FlowVault({
  network: "testnet",
  contractAddress: "STD7QG84VQQ0C35SZM2EYTHZV4M8FQ0R7YNSQWPD",
  contractName: "flowvault-v2",
  tokenContractAddress: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
  tokenContractName: "usdcx",
  senderAddress: walletAddress, // resolved STX address from wallet connect, ST.../SP... only
  contractCallExecutor: async (call) => request("stx_callContract", {
    contract: call.contractAddress + "." + call.contractName,
    functionName: call.functionName,
    functionArgs: call.functionArgs,
    network: call.network,
    postConditionMode: "allow",
    postConditions: call.postConditions,
  }),
});
```

Method surface (both modes, same calls):
```ts
await vault.setRoutingRules({ lockAmount, lockUntilBlock, splitAddress, splitAmount }); // strings/bigint
await vault.deposit(amountMicro);
await vault.withdraw(amountMicro);
await vault.clearRoutingRules();

const state = await vault.getVaultState(address);         // { unlocked, locked, ... }
const rules = await vault.getRoutingRules(address);
const hasLock = await vault.hasLockedFunds(address);
const block = await vault.getCurrentBlockHeight(address);
```

Env vars (`.env.example`, both `cli/` and `frontend/`):
```
NEXT_PUBLIC_FLOWVAULT_NETWORK=testnet
NEXT_PUBLIC_FLOWVAULT_CONTRACT_ADDRESS=STD7QG84VQQ0C35SZM2EYTHZV4M8FQ0R7YNSQWPD
NEXT_PUBLIC_FLOWVAULT_CONTRACT_NAME=flowvault-v2
NEXT_PUBLIC_FLOWVAULT_TOKEN_CONTRACT_ADDRESS=ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM
NEXT_PUBLIC_FLOWVAULT_TOKEN_CONTRACT_NAME=usdcx
```

Validation rules to enforce client-side in `flowvault-adapter` (from docs, do not skip):
- STX address format only (`ST...`/`SP...`); reject `tb1...` with a clear error, per the docs' Troubleshooting page (`InvalidAddressError`).
- `lockUntilBlock` must be a future block when `lockAmount > 0`; compute as `current + durationBlocks`, never a hardcoded block number.
- `splitAddress` required whenever `splitAmount > 0`.
- All amounts string/bigint, never floats.
- Guard `splitAmount + lockAmount <= depositAmount` before sending (contract aborts otherwise per the Troubleshooting doc's "Deposit tx fails immediately" row).
- Map every typed SDK error to a specific user-facing message: `InvalidAmountError`, `InvalidAddressError`, `InvalidRoutingRuleError`, `InvalidConfigurationError`, `ContractCallError`, `NetworkError`, `ParsingError`.

## 7. `policy-compiler` — local-rules provider (zero-cost default)

**Keyword-to-adjustment mapping table.** Implement `local-rules.ts` as a deterministic parser using this table. Scan the input text (lowercased) for these phrases; each match contributes one entry to `PolicySpec.adjustments`. If no percentage is stated for a matched phrase, use the listed default.

| Trigger phrase(s) in input text | `when` | default `thresholdCount` | default `effect` |
|---|---|---|---|
| "early withdraw", "withdraws early", "drains immediately" | `early_withdraw_streak` | 2 | `lockPercentDelta: +20, lockDurationDeltaBlocks: +720` (~5 days at ~10min/block) |
| "never withdraws early", "honors the lock", "leaves it locked" | `honored_lock_streak` | 3 | `lockPercentDelta: -15, lockDurationDeltaBlocks: -360` |
| "stops depositing", "misses a deposit", "goes quiet" | `deposit_cadence_broken` | n/a (uses `thresholdWindowBlocks`, default 4320 ≈ 30 days) | `lockPercentDelta: +10, lockDurationDeltaBlocks: 0` |
| "outflow spikes", "large withdrawals", "draining the treasury" | `outflow_velocity_spike` | 3 (within `thresholdWindowBlocks`, default 144 ≈ 1 day) | `lockPercentDelta: +25, lockDurationDeltaBlocks: +1440` |

Percentage/duration overrides: if the text contains a number immediately followed by `%` near a matched phrase, use that number for the relevant `*Percent`/`*PercentDelta` field instead of the default. If it contains a number followed by "day(s)"/"block(s)" near "lock", set `baseline.lockDurationBlocks` (convert days to blocks assuming ~144 blocks/day at ~10 min/block; document this constant in a comment since actual Stacks block time varies). `splitAddress` is extracted via regex for a token matching `^(ST|SP)[A-Z0-9]{38,40}$`; if none found but a split percentage is mentioned, leave `splitAddress: null` and surface a UI warning ("split percent given but no address found in policy text").

`baseline` defaults when nothing else is stated: `lockPercent: 50, lockDurationBlocks: 4320, splitAddress: null, splitPercent: 0`. `bounds` defaults: `minLockPercent: 0, maxLockPercent: 90, minLockDurationBlocks: 144, maxLockDurationBlocks: 52560` (~1 year).

This parser must alone be able to produce valid, schema-passing `PolicySpec`s for all 5 example policies in section 10 with zero API key set — verify this as part of the section 12 gate.

## 8. `policy-compiler` — optional LLM providers (Gemini, Groq)

**Both are real, currently-free options, verified at spec-writing time. Rate limits change without notice (Google cut Gemini free quotas 50-80% in one weekend in December 2025) — do not hardcode a specific RPM/RPD number into retry logic; instead, implement generic 429-aware backoff and always have a working fallback to `local-rules`.**

**Gemini** (Google AI Studio):
- Sign up at https://aistudio.google.com — no credit card required to generate a key.
- As of the docs available when this task was written, the free tier covers the **Flash and Flash-Lite model family** (e.g. `gemini-2.5-flash`, `gemini-2.5-flash-lite`) — Pro-tier models have moved behind paid billing. **Verify current model availability at https://ai.google.dev/gemini-api/docs/pricing before hardcoding a model string**, since Google has changed this list multiple times in the months before this spec was written.
- Env var: `GEMINI_API_KEY`.
- Use the official `@google/genai` SDK (or direct REST to the `generateContent` endpoint) with `responseMimeType: "application/json"` and a response schema matching `PolicySpecSchema` if the SDK version in use supports structured output; otherwise parse the text response and validate against the zod schema regardless.

**Groq**:
- Sign up at https://console.groq.com — no credit card required.
- Free tier covers **every model Groq hosts** (Llama 3.3 70B, Llama 3.1 8B, GPT-OSS, Qwen3, etc.), gated by rate limit rather than model access. **Verify current per-model limits at https://console.groq.com/docs/rate-limits before assuming a specific number**, as these are set per model and have changed.
- Env var: `GROQ_API_KEY`.
- Endpoint is OpenAI-compatible: use the `openai` npm package pointed at `baseURL: "https://api.groq.com/openai/v1"`, `apiKey: process.env.GROQ_API_KEY`, e.g. `model: "llama-3.3-70b-versatile"`. This means the exact same client code pattern works for Groq as any OpenAI-compatible provider — useful if you want a third fallback (e.g. an OpenRouter `:free` model) later without new code, just a different `baseURL`.
- Both provider rate limits apply per-organization/per-project, not per API key — do not attempt a multi-key workaround.

Both providers: on any error (network, 429, invalid JSON, schema validation failure after one retry), fall back to the `local-rules` output and surface "AI parse failed, used rule-based fallback" in the UI — never crash, never block the demo.

## 9. `tools/agent-tool-schema.json` — full body

**Previously named but never specified. Create this exact file** (values illustrative for the JSON Schema portions; keep field names exact since this is what makes the "usable by any agent" claim concrete):

```json
{
  "name": "covenant_propose_routing_plan",
  "description": "Given a FlowVault principal's on-chain behavior history and a treasury policy, deterministically computes the next lock/split/hold routing configuration. Does not execute any transaction — returns a plan for the caller to review and apply via FlowVault's setRoutingRules.",
  "input_schema": {
    "type": "object",
    "properties": {
      "address": { "type": "string", "description": "STX or SP principal address" },
      "policy": { "type": "object", "description": "A PolicySpec object, see covenant-core/src/policySpec.ts" },
      "depositAmountMicro": { "type": "string", "description": "Deposit amount in micro-units, as a string" },
      "currentBlock": { "type": "integer" }
    },
    "required": ["address", "policy", "depositAmountMicro", "currentBlock"]
  },
  "output_schema": {
    "type": "object",
    "properties": {
      "splitAddress": { "type": ["string", "null"] },
      "splitAmountMicro": { "type": "string" },
      "lockAmountMicro": { "type": "string" },
      "lockUntilBlock": { "type": "integer" },
      "rationale": { "type": "string" },
      "appliedAdjustmentIds": { "type": "array", "items": { "type": "string" } }
    },
    "required": ["splitAddress", "splitAmountMicro", "lockAmountMicro", "lockUntilBlock", "rationale", "appliedAdjustmentIds"]
  }
}
```

This should be a thin JSON-Schema wrapper around `covenant-core`'s `engine()` function signature — implement a small handler that imports `engine` directly and validates input/output against this schema, so the file is documentation of a real, testable contract, not aspirational copy.

## 10. Five example `PolicySpec` policies (write these as real files in `policy-compiler/examples/`)

Each maps to a specific section-5 test scenario so the demo can show cause and effect clearly.

1. **`vesting-strict-after-early-withdraw.json`** — baseline `lockPercent: 40, lockDurationBlocks: 2160, splitPercent: 0, splitAddress: null`; one `early_withdraw_streak` adjustment, `thresholdCount: 2`, effect `lockPercentDelta: +30, lockDurationDeltaBlocks: +2160`, `decay: "reset_on_opposite"`. English source: *"Lock 40% of each deposit for 15 days. If someone withdraws early twice in a row, lock 70% for 30 days until they go back to honoring locks."* (exercises test #2, #4)
2. **`savings-loosens-with-discipline.json`** — baseline `lockPercent: 60, lockDurationBlocks: 4320, splitPercent: 0, splitAddress: null`; one `honored_lock_streak` adjustment, `thresholdCount: 3`, effect `lockPercentDelta: -25, lockDurationDeltaBlocks: -1440`, `decay: "reset_on_opposite"`. English source: *"Lock 60% of every deposit for 30 days as a savings discipline. After three honored locks in a row, ease up to a lighter lock."* (exercises test #3)
3. **`payroll-split-only.json`** — baseline `lockPercent: 0, lockDurationBlocks: 144, splitPercent: 20, splitAddress: "<example ST address>"`; no adjustments. English source: *"Every deposit, send 20% straight to our contributor payout address, keep the rest liquid."* (exercises test #8)
4. **`treasury-tightens-on-outflow-spike.json`** — baseline `lockPercent: 30, lockDurationBlocks: 720, splitPercent: 0, splitAddress: null`; one `outflow_velocity_spike` adjustment, `thresholdCount: 3, thresholdWindowBlocks: 144`, effect `lockPercentDelta: +35, lockDurationDeltaBlocks: +2880`, `decay: "expires_after_n_cycles", decayCycles: 2`. English source: *"Keep 30% of the treasury locked normally. If we see 3+ large withdrawals in a single day, lock 65% for the next two cycles to protect the reserve."* (exercises test #6)
5. **`hold-until-trust-established.json`** — baseline `lockPercent: 0, lockDurationBlocks: 144, splitPercent: 0, splitAddress: null`; one `early_withdraw_streak` adjustment, `thresholdCount: 1`, effect `lockPercentDelta: +40, lockDurationDeltaBlocks: +1440`, `decay: "reset_on_opposite"`. English source: *"By default, don't lock anything — keep it all liquid. But the moment someone withdraws early even once, start locking 40% for 10 days until trust is rebuilt."* (exercises test #10)

These same 5 policies are what `local-rules` (section 7) must be able to reproduce from their English source strings, and what the demo video walks through.

## 11. Bounty submission form — pre-filled answers

Put this in `submission/form-answers.md` verbatim (fill in the blanks marked `<>` before submitting):

```
Name / Team Name: <your name>
Email Address: <email>
Telegram / X Username: <handle>
Stacks Wallet Address: <ST... testnet address used for the on-chain proof tx>

Project Name: Covenant
One-Line Description: A behavior-adaptive routing engine for FlowVault — vesting, savings, and
treasury rules that tighten or loosen automatically based on on-chain history, compiled from
plain-English policy and reusable across payroll, savings, treasury, and creator-revenue use cases.

Project Category: Payroll & Compensation, Goal-Based Savings, Treasury Automation,
Creator Revenue Flows, Experimental Financial Behaviors
(all five apply — Covenant is one engine, config-selectable across all of them; explain this
explicitly to the judges rather than picking one, since it's the core of the Ecosystem Value pitch)

What problem does your project solve?
FlowVault's routing rules are static: one lock, one split, set once, unchanged until a human
reconfigures them. Every real use of programmable money — contributor vesting, savings
discipline, treasury reserves, revenue splits — actually needs rules that respond to behavior:
reward reliability, tighten after risky activity, adapt to changing conditions. FlowVault's
contract intentionally has no concept of history, so nothing built directly on it can do this.
Covenant is the missing layer: it watches on-chain behavior over time and re-issues FlowVault
routing rules accordingly, turning a static primitive into an adaptive one, without changing or
redeploying the contract.

How does your project use FlowVault?
Explain which primitives are used: Combination — Lock, Split, and Hold are all used, and which
one is active (and how strict) changes over time based on a principal's own history. A plain-
English policy is compiled (via an optional, swappable, free-tier LLM layer with a zero-cost
deterministic fallback) into a structured PolicySpec. A separate, LLM-independent engine reads
on-chain state via getVaultState/getRoutingRules/getCurrentBlockHeight, derives behavior signals
(early-withdraw streaks, honored-lock streaks, deposit cadence, outflow velocity), and computes
the next lock/split/hold configuration, which is applied via setRoutingRules. This repeats every
cycle, so the same deposit address can move from a strict lock to a looser one (or vice versa)
purely as a function of its own on-chain behavior — a financial behavior FlowVault's static
contract cannot express on its own.

GitHub Repository: <link>
Live Demo URL: <link>
Demo Video (YouTube/Loom): <link>
Presentation / Documentation Link: <README link, Ecosystem Value section specifically>

On-Chain Proof:
Provide at least one successful transaction demonstrating FlowVault integration
<testnet tx id + explorer link from section 12's verification gate — include at least two, ideally
showing the SAME address's routing rules changing between cycles, since that's the actual proof
of the adaptive behavior, not just "a deposit happened">

If given additional funding, how would you continue building this project?
Publish covenant-core and policy-compiler as standalone npm packages with a stable API so other
FlowVault builders can add behavior-adaptive routing to their own apps without adopting our UI.
Add more BehaviorSignals (counterparty reliability across shared vaults, multi-principal DAO
policies), a hosted trigger-checking service (so re-planning doesn't depend on a browser tab
being open), and a policy marketplace where teams can share/fork PolicySpec templates for common
use cases (contributor vesting, DAO reserves, creator splits).
```

## 12. Explicit "do not" list

- Do not build a single fixed lock% + split% demo with no adjustment logic — that's exactly `savings.flow-vault.dev`/`flowpay.flow-vault.dev` and is explicitly disqualifying.
- Do not let `covenant-core` import `flowvault-sdk` or any Stacks-specific code — the package boundary is the actual product claim in section 1.
- Do not let the LLM execute a transaction, choose a final numeric value without schema validation, or be a single point of failure for the demo.
- Do not put any private key or seed phrase in frontend code, committed env files, or logs.
- Do not claim on-chain history that isn't real — be explicit in the README that behavior history is tracked off-chain (locally) by polling read-state, since the contract itself is stateless across cycles.
- Do not hardcode a specific LLM free-tier rate-limit number into retry/backoff logic — implement generic 429 handling and a working fallback instead, and verify current limits at the URLs in section 8 before demoing.
- Do not mix testnet/mainnet contract or token principals anywhere.
- Do not claim mainnet deployment — this bounty period runs on testnet.

## 13. Verification gate before calling this "done"

1. `contracts-notes.md` confirms integration against existing deployed `flowvault-v2`, no redeploy.
2. All `covenant-core` scenario tests from section 5 pass, with zero blockchain or LLM imports in that package.
3. `policy-compiler` produces valid, schema-passing `PolicySpec`s from all 5 example policies in section 10 using `local-rules` alone (no API key set).
4. CLI (`cli/`) runs one full plan+execute cycle against testnet from the command line, independent of the frontend, reading/writing its own `HistoryLogEntry` file.
5. Frontend: connect wallet, STX address detected, preview plan, execute (`setRoutingRules` + `deposit`, tx ids returned and linkable).
6. Simulate at least two cycles for the same address with different behavior (e.g., one early withdraw, then one honored lock) and show the resulting `RoutingPlan` differs between cycles — capture both tx ids for the on-chain proof section.
7. Auto-execute toggle and confirm-first mode both work: confirm-first shows the proposed plan and waits for a click; auto-execute (opt-in, clearly labeled) signs immediately when a trigger fires. Demo confirm-first live; show the auto-execute toggle exists.
8. Every typed SDK error mapped to a clear message (test at least `InvalidAddressError` and the split+lock-exceeds-deposit case).
9. If Gemini/Groq providers are wired in: confirm the fallback to `local-rules` actually works by testing with an invalid/missing API key, not just reading the code.

## 14. Deliverables checklist (must match bounty's Submission Requirements)

1. Public GitHub repo, structure per section 1, MIT or similar license.
2. Working demo deployed (Vercel fine), testnet only.
3. Demo video (3-5 min), scripted in `DEMO.md`: state a policy in English, show compiled PolicySpec, execute cycle 1, show state/tx, simulate behavior, execute cycle 2 with a visibly different plan, show audit trail, show CLI and agent-tool-schema.json briefly.
4. README "FlowVault Integration" section per section 11's answer, plus an explicit "Ecosystem Value" section describing the package boundary and the CLI/tool-schema consumers.
5. At least two testnet transactions linked with explorer URLs, showing rule change between cycles.
6. Confirm SDK usage (`flowvault-sdk@0.1.1`, wallet executor mode) explicitly in README.
7. `submission/form-answers.md` filled in and used for the official form + Zero Authority DAO confirmation + Telegram join (all three mandatory).

## 15. Suggested build order

1. Scaffold repo per section 1.
2. Build `covenant-core` fully first: `policySpec.ts`, `behaviorSignals.ts`, `routingPlan.ts`, `history.ts`, `engine.ts`, all 10 test scenarios from section 5 — zero chain/LLM deps, this is the real IP and should be solid before anything else is touched.
3. Write the 5 example `PolicySpec` files from section 10, confirm each passes `PolicySpecSchema` and produces sensible `engine()` output against hand-crafted `BehaviorSignals` fixtures.
4. Build `policy-compiler`'s `local-rules` provider per section 7's table; verify it reproduces all 5 example policies from their English source strings.
5. Build `flowvault-adapter` using the exact code in section 6.
6. Build `cli/` — smallest possible consumer, proves the package boundary works end-to-end on testnet.
7. Build `frontend/` as a thin consumer of the same three packages.
8. Add Gemini/Groq providers per section 8, behind the same interface as `local-rules`, with verified-current model names and working fallback.
9. Write `tools/agent-tool-schema.json` per section 9 and the Ecosystem Value README section.
10. Run the full verification gate (section 13) on testnet with a real wallet.
11. Fill in `submission/form-answers.md`, record demo video, submit via official form, confirm on Zero Authority DAO page, join Telegram.
