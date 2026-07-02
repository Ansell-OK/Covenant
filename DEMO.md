# Covenant — Demo Script (3-5 min)

## Setup

Before recording:
1. Start the frontend: `cd packages/frontend && npm run dev`
2. Reset history for a clean demo: `del .covenant\history-<YOUR_ADDRESS>.json`
3. Have your Leather or Hiro wallet open and connected to testnet
4. Have `.env.local` set with `STACKS_PRIVATE_KEY` for the CLI portion

---

## Scene 1: State a policy in English (0:00 - 0:40)

1. Open http://localhost:3000 in the browser
2. Show the **Policy Compiler** panel on the left
3. Type (or paste) the English policy:
   > "Lock 40% of each deposit for 15 days. If someone withdraws early twice in a row, lock 70% for 30 days until they go back to honoring locks."
4. Click **Compile Policy**
5. Show the resulting **PolicySpec JSON** preview:
   - `lockPercent: 40`, `lockDurationBlocks: 2160`
   - One `early_withdraw_streak` adjustment: `thresholdCount: 2`, `lockPercentDelta: +30`
   - `decay: "reset_on_opposite"`
6. Point out: "This is `vesting-strict-after-early-withdraw.json` — one of the five example policies"

---

## Scene 2: Execute Cycle 1 — Fresh principal (0:40 - 1:30)

1. Connect wallet — click **Connect Wallet**, select Leather/Hiro, approve
2. Show STX address detected (ST.../SP... format)
3. **Behavior Signals** panel shows:
   - `consecutiveEarlyWithdraws: 0`
   - `consecutiveHonoredLocks: 0`
   - `blocksSinceLastDeposit: null` (fresh)
4. Click **Preview Plan** → **Routing Plan** shows:
   - Lock: 400,000 micro (40%)
   - Lock until block: ~current + 2160
   - Rationale: "Baseline policy applied..."
   - `appliedAdjustmentIds: []`
5. Click **Execute Plan** (confirm-first mode — plan shown before signing)
6. Wallet asks for signature → approve
7. Two tx IDs appear: `setRoutingRules` + `deposit`
8. Show Hiro Explorer link → tx confirmed on testnet

---

## Scene 3: Simulate behavior — two early withdraws (1:30 - 2:15)

1. Navigate to **Simulate** or use CLI:
   ```bash
   npx ts-node packages/cli/src/index.ts withdraw \
     --address <YOUR_ST_ADDRESS> --amount 100000
   ```
2. Do this twice (or show the history already has two early withdraws)
3. Show the **History** panel: 2 withdraw events with `wasEarlyWithdraw: true`
4. **Behavior Signals** update:
   - `consecutiveEarlyWithdraws: 2` ← threshold met!

---

## Scene 4: Execute Cycle 2 — Adaptive response (2:15 - 3:15)

1. Click **Preview Plan** again (same policy, same address)
2. **Routing Plan** now shows:
   - Lock: 700,000 micro (70%)  ← tightened from 40%!
   - Lock until: ~current + 4320 (30 days)  ← doubled from 15 days
   - Rationale: "Adjustments applied due to repeated early withdrawals..."
   - `appliedAdjustmentIds: ["early_withdraw_streak"]`
3. Click **Execute Plan** → sign → confirm
4. Two new tx IDs appear
5. Show BOTH tx IDs for the routing-rules change:
   - Cycle 1 setRoutingRules: `0x...` → 40% lock
   - Cycle 2 setRoutingRules: `0x...` → 70% lock
   - **These are the on-chain proof of adaptive behavior**

---

## Scene 5: Audit trail + confirm-first vs auto-execute (3:15 - 3:45)

1. Show the **Audit Trail** panel: full history of cycles, signals, plans
2. Show the **Auto-execute toggle** (clearly labeled opt-in)
   - "In confirm-first mode, you see the plan before signing — great for demos"
   - "Auto-execute fires immediately when a trigger condition is met — useful for agents"
3. Toggle it off again (confirm-first is the demo default)

---

## Scene 6: CLI + agent tool schema (3:45 - 4:15)

1. Show CLI in terminal:
   ```bash
   npx ts-node packages/cli/src/index.ts run \
     --address <YOUR_ST_ADDRESS> \
     --policy packages/policy-compiler/examples/treasury-tightens-on-outflow-spike.json \
     --dry-run
   ```
2. Show output: signals, routing plan, rationale — no transaction, no key needed for dry run
3. Open `tools/agent-tool-schema.json` briefly
   - "Any AI agent — Claude, GPT, Gemini — can call `covenant_propose_routing_plan`"
   - "It returns a RoutingPlan for review. The agent never executes a transaction."
4. Close

---

## Scene 7: Fallback demo (4:15 - 4:30)

1. Set `GEMINI_API_KEY=invalid` in .env.local
2. Reload and compile the same policy text
3. Show banner: "AI parse failed, used rule-based fallback"
4. PolicySpec still appears — identical to before
5. "The demo can't fail due to a rate limit or bad API key"

---

## Reset for a clean demo run

```bash
# Delete history (off-chain — contract state is separate)
del .covenant\history-<YOUR_ADDRESS>.json

# The contract still holds your vault state —
# this only resets Covenant's behavior tracking
```

**Note:** Covenant's behavior history is tracked off-chain. The FlowVault contract is stateless across cycles — it doesn't know about previous transactions. Deleting the history file resets Covenant's signals to "fresh principal" state without touching the contract.
