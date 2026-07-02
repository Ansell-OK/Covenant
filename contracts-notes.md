# Covenant — Contract Notes

## FlowVault Contract Integration

Covenant integrates against the **existing, already-deployed** `flowvault-v2` contract on Stacks testnet.

**No contract deployment is required or performed by this project.**

### Deployed Contract Details

| Field | Value |
|---|---|
| Network | Stacks Testnet |
| Contract Address | `STD7QG84VQQ0C35SZM2EYTHZV4M8FQ0R7YNSQWPD` |
| Contract Name | `flowvault-v2` |
| Token Contract Address | `ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM` |
| Token Contract Name | `usdcx` |
| SDK Package | `flowvault-sdk@0.1.1` (pinned) |

### Why No Redeploy

The FlowVault contract is intentionally simple: one lock rule and one split rule per principal, static until `setRoutingRules` is called again. Covenant does not need to modify or extend the contract — it is the **stateful layer above it** that calls `setRoutingRules` on each cycle based on computed behavior signals. The contract's statelessness between cycles is the design constraint that makes Covenant valuable and non-overlapping.

### Contract Methods Used

| Method | Used By |
|---|---|
| `setRoutingRules({ lockAmount, lockUntilBlock, splitAddress, splitAmount })` | `flowvault-adapter/executor.ts` |
| `deposit(amountMicro)` | `flowvault-adapter/executor.ts` |
| `withdraw(amountMicro)` | `flowvault-adapter/executor.ts` |
| `clearRoutingRules()` | `flowvault-adapter/executor.ts` |
| `getVaultState(address)` | `flowvault-adapter/executor.ts` (for history polling) |
| `getRoutingRules(address)` | `flowvault-adapter/executor.ts` (for history polling) |
| `getCurrentBlockHeight(address)` | `flowvault-adapter/executor.ts` (for lockUntilBlock computation) |
| `hasLockedFunds(address)` | `flowvault-adapter/executor.ts` (for early-withdraw detection) |
