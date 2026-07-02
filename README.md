# Covenant — Behavioral Vesting Engine for FlowVault

> One engine. Four bounty categories. Routing rules that adapt to behavior.

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Stacks Testnet](https://img.shields.io/badge/network-testnet-orange.svg)](https://explorer.hiro.so)
[![flowvault-sdk](https://img.shields.io/badge/flowvault--sdk-0.1.1-purple.svg)](https://www.npmjs.com/package/flowvault-sdk)

## What is Covenant?

FlowVault's contract is intentionally simple: one lock rule and one split rule per principal, static until you call `setRoutingRules` again. That's a strength (auditable, safe) but it means the contract has zero concept of history — it can't know if you withdrew the second funds unlocked last time, or if you've been depositing consistently, or if a counterparty has been reliable.

**Covenant is the stateful layer FlowVault's contract can't be.** It watches on-chain behavior (deposit cadence, early-withdraw vs. honored-lock history, outflow velocity) and computes a new routing rule every cycle, re-issuing `setRoutingRules` so the vault's actual behavior changes over time based on what happened, not on a fixed schedule.

One deterministic engine. Four bounty categories (payroll/vesting, savings, treasury, creator revenue). Because the mechanism — behavior to rule — is generic, and the policy (what counts as "good behavior" and what the response is) is just config.

---

## FlowVault Integration

**SDK version:** `flowvault-sdk@0.1.1` (pinned)

**Contract:** `STD7QG84VQQ0C35SZM2EYTHZV4M8FQ0R7YNSQWPD.flowvault-v2` (Stacks testnet, no redeploy)

**FlowVault primitives used:** Lock, Split, and Hold — all three. Which one is active, and how strict, changes over time based on the principal's own history.

| SDK Method | Where Used |
|---|---|
| `setRoutingRules({ lockAmount, lockUntilBlock, splitAddress, splitAmount })` | Every cycle — the adaptive action |
| `deposit(amountMicro)` | After setRoutingRules, in the same cycle |
| `withdraw(amountMicro)` | CLI withdraw command + frontend |
| `clearRoutingRules()` | Available via executor |
| `getVaultState(address)` | Fetching unlocked/locked balance per cycle |
| `getRoutingRules(address)` | Determining if a withdraw is "early" |
| `getCurrentBlockHeight(address)` | Computing lockUntilBlock |
| `hasLockedFunds(address)` | Early-withdraw detection |

**Wallet integration mode:** Browser wallet via `@stacks/connect` (`request("stx_callContract", ...)`). No private keys in the frontend. CLI uses `senderKey` from `STACKS_PRIVATE_KEY` env var only.

**Client-side validation enforced before any SDK call:**
- STX/SP address format only; `tb1...` rejected with `InvalidAddressError`
- `lockUntilBlock` is always `currentBlock + lockDurationBlocks` — never a hardcoded number
- `splitAddress` required whenever `splitAmount > 0`
- All amounts as strings (bigint), never floats
- `splitAmount + lockAmount <= depositAmount` (contract aborts otherwise)
- Every typed SDK error (`InvalidAmountError`, `InvalidAddressError`, `InvalidRoutingRuleError`, `InvalidConfigurationError`, `ContractCallError`, `NetworkError`, `ParsingError`) mapped to a specific user-facing message

---

## Architecture

```
packages/
  covenant-core/            # pure TS, zero blockchain deps, zero LLM deps
    src/policySpec.ts        # Zod schema: the generic "behavior -> rule" config
    src/behaviorSignals.ts   # BehaviorSignals type + derivation from history
    src/routingPlan.ts       # RoutingPlan: the engine's output, input to adapter
    src/engine.ts            # (BehaviorSignals, PolicySpec) -> RoutingPlan
    src/history.ts           # HistoryLogEntry schema + read/write helpers
    src/__tests__/           # 10 table-driven scenarios (section 5 of spec)
  policy-compiler/          # optional: English -> PolicySpec
    src/compile.ts           # provider chain: Gemini -> Groq -> local-rules
    src/providers/local-rules.ts   # zero-cost default (no API key)
    src/providers/gemini.ts        # optional, free tier
    src/providers/groq.ts          # optional, free tier (OpenAI-compatible)
    examples/                # 5 example PolicySpec files
  flowvault-adapter/        # the ONLY package that touches flowvault-sdk
    src/client.ts            # SDK init: CLI mode (senderKey) + browser mode
    src/executor.ts          # RoutingPlan -> setRoutingRules/deposit/withdraw
  cli/                      # npx covenant run --policy policy.json --address ST...
  frontend/                 # Next.js UI — thin consumer of the three packages
tools/
  agent-tool-schema.json    # JSON Schema for the engine() function
submission/
  form-answers.md           # bounty submission form
```

**Package boundary — the actual product claim:** `covenant-core` has zero imports from `flowvault-sdk` or any Stacks-specific code. It takes signals in, returns a `RoutingPlan` out. The adapter is the only package that touches the chain.

---

## Ecosystem Value

### Reusable Packages

Every component of Covenant is designed to be consumed independently:

| Package | What it exports | Who can use it |
|---|---|---|
| `@covenant/core` | `engine()`, `PolicySpec`, `BehaviorSignals`, `RoutingPlan` | Any FlowVault builder wanting behavior-adaptive routing without Covenant's UI |
| `@covenant/policy-compiler` | `compile(text): PolicySpec` | Any app wanting natural-language policy configuration |
| `@covenant/flowvault-adapter` | SDK client + executor + error types | Any project needing typed, validated FlowVault SDK integration |

### The Agent Tool Schema

`tools/agent-tool-schema.json` is a full JSON Schema describing `covenant_propose_routing_plan` — the engine wrapped as a tool that any AI agent (Claude, GPT, Gemini) can call to propose routing plans without executing transactions. The tool returns a `RoutingPlan` for the caller to review and apply. This is the "AI treasury agents" use case flagged as High Innovation Potential in the bounty.

### Use Cases from One Engine

Every use case is the same engine with a different `PolicySpec`. Examples in `packages/policy-compiler/examples/`:

| File | Use Case | Key Behavior |
|---|---|---|
| `vesting-strict-after-early-withdraw.json` | Contributor vesting | Lock escalates after early withdraws, resets on discipline |
| `savings-loosens-with-discipline.json` | Goal-based savings | Lock eases after consistent behavior |
| `payroll-split-only.json` | Payroll / revenue split | 20% to contributor, rest liquid |
| `treasury-tightens-on-outflow-spike.json` | DAO treasury | Locks tighten temporarily after outflow spikes |
| `hold-until-trust-established.json` | Trust-gated access | Hold-only default, lock appears only as punishment |

---

## Quick Start

```bash
# Install dependencies
npm install

# CLI: dry run (no transaction, no key needed)
cd packages/cli
npx ts-node src/index.ts run \
  --address ST1YOURADDRESS \
  --policy ../policy-compiler/examples/vesting-strict-after-early-withdraw.json \
  --dry-run

# CLI: live run (requires STACKS_PRIVATE_KEY in .env)
npx ts-node src/index.ts run \
  --address ST1YOURADDRESS \
  --policy ../policy-compiler/examples/savings-loosens-with-discipline.json \
  --deposit 1000000

# Frontend
cd packages/frontend
npm run dev
# → http://localhost:3000
```

**Environment setup:**
```bash
cp .env.example .env.local
# Fill in STACKS_PRIVATE_KEY (CLI only)
# Optionally add GEMINI_API_KEY and/or GROQ_API_KEY
```

---

## Testing

```bash
# Run all 10 engine scenarios (zero chain/LLM deps)
cd packages/covenant-core
npx vitest run
```

All 10 scenarios from the specification pass, asserting `RoutingPlan` output for:
1. Fresh principal → baseline applied
2. Early withdraw streak → tightening
3. Honored lock streak → loosening
4. Streak reset via `decay: "reset_on_opposite"`
5. Deposit cadence broken → tightening
6. Outflow velocity spike → tightening
7. Two simultaneous adjustments → summed, clamped
8. Split-only policy → `lockAmountMicro: "0"`
9. Lock-only policy → `splitAmountMicro: "0"`
10. Hold-only baseline → lock appears only on bad behavior

---

## Off-chain History Disclaimer

Covenant tracks behavior history **off-chain** (locally in `.covenant/history-<address>.json` for the CLI, or IndexedDB for the frontend). The FlowVault contract itself is stateless between cycles — it has no knowledge of previous deposits or withdraws across transactions. Covenant polls `getVaultState`, `getRoutingRules`, and `getCurrentBlockHeight` to build `HistoryLogEntry` records, but the history store itself is off-chain. This is documented here because it's a design decision, not a limitation: the contract being stateless is what makes Covenant's adaptive layer valuable and non-overlapping with the contract's responsibilities.

To reset history for a clean demo run, delete `.covenant/history-<address>.json`.

---

## License

MIT
