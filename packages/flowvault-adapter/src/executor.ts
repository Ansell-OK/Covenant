// flowvault-adapter/src/executor.ts
// Takes a RoutingPlan from covenant-core and executes SDK calls.
//
// Validation rules enforced before any SDK call (from task §6):
//   1. STX address format only (ST.../SP...); reject tb1... with InvalidAddressError
//   2. lockUntilBlock must be a future block when lockAmount > 0
//   3. splitAddress required whenever splitAmount > 0
//   4. All amounts as strings/bigint, never floats
//   5. splitAmount + lockAmount <= depositAmount (contract aborts otherwise)
//   6. Every typed SDK error mapped to a specific user-facing message
//
// The RoutingPlan -> SDK call mapping is 1:1 (no further transformation):
//   RoutingPlan.lockAmountMicro  -> setRoutingRules({ lockAmount })
//   RoutingPlan.splitAmountMicro -> setRoutingRules({ splitAmount })
//   RoutingPlan.lockUntilBlock   -> setRoutingRules({ lockUntilBlock })
//   RoutingPlan.splitAddress     -> setRoutingRules({ splitAddress })

import { FlowVault } from "flowvault-sdk";
import { RoutingPlan, HistoryLogEntry, makeDepositEntry, makeWithdrawEntry, makeSetRoutingRulesEntry } from "@covenant/core";
import {
  validateSTXAddress,
  InvalidAddressError,
  InvalidAmountError,
  InvalidRoutingRuleError,
  ContractCallError,
  NetworkError,
  ParsingError,
} from "./client";

export interface ExecuteDepositCycleResult {
  setRulesTxId: string;
  depositTxId: string;
  historyEntries: HistoryLogEntry[];
}

/**
 * Execute one full deposit cycle:
 *   1. Validate the RoutingPlan
 *   2. Call setRoutingRules with the plan's values
 *   3. Call deposit with the specified amount
 *   4. Return tx IDs and HistoryLogEntry records for the caller to persist
 *
 * @param vault - FlowVault client (CLI or browser mode)
 * @param address - The principal's STX address
 * @param plan - RoutingPlan from covenant-core's engine()
 * @param depositAmountMicro - Amount to deposit (bigint as string)
 * @param currentBlock - Current block height
 */
export async function executeDepositCycle(
  vault: FlowVault,
  address: string,
  plan: RoutingPlan,
  depositAmountMicro: string,
  currentBlock: number
): Promise<ExecuteDepositCycleResult> {
  // ── Validation ──────────────────────────────────────────────────────────
  validateRoutingPlan(plan, depositAmountMicro, currentBlock);

  try {
    // ── Step 1: setRoutingRules ──────────────────────────────────────────
    const setRulesResult = await vault.setRoutingRules({
      lockAmount: plan.lockAmountMicro,
      lockUntilBlock: plan.lockUntilBlock,
      splitAddress: plan.splitAddress ?? "",
      splitAmount: plan.splitAmountMicro,
    });

    const setRulesTxId = extractTxId(setRulesResult);

    // ── Step 2: deposit ─────────────────────────────────────────────────
    const depositResult = await vault.deposit(depositAmountMicro);
    const depositTxId = extractTxId(depositResult);

    // ── Step 3: Build history entries ───────────────────────────────────
    const historyEntries: HistoryLogEntry[] = [
      makeSetRoutingRulesEntry(address, currentBlock, setRulesTxId),
      makeDepositEntry(address, currentBlock, depositAmountMicro, depositTxId),
    ];

    return { setRulesTxId, depositTxId, historyEntries };
  } catch (err: unknown) {
    throw mapSdkError(err);
  }
}

/**
 * Execute a withdraw, determining wasEarlyWithdraw based on current vault state.
 *
 * @param vault - FlowVault client
 * @param address - The principal's STX address
 * @param amountMicro - Amount to withdraw (bigint as string)
 * @param currentBlock - Current block height
 */
export async function executeWithdraw(
  vault: FlowVault,
  address: string,
  amountMicro: string,
  currentBlock: number
): Promise<{ txId: string; historyEntry: HistoryLogEntry }> {
  // Check if there are locked funds that haven't expired yet
  // Use getVaultState (real, live locked balance), NOT getRoutingRules (the
  // configured rule, which stays set even after the lock has already been
  // consumed or matured). Checking the rule instead of live state was the
  // actual bug: it can report a "future" lockUntilBlock from the configured
  // rule while the real vault balance has already correctly unlocked, or
  // vice versa. Confirmed against real decoded on-chain data tonight that
  // vaultState.lockedBalance is the accurate, live source of truth for
  // whether funds are ACTUALLY still locked right now.
  let hasActiveLock = false;
    try {
      const state = await vault.getVaultState(address);
      if (state && BigInt(state.lockedBalance ?? 0) > 0n && state.lockUntilBlock > currentBlock) {
      hasActiveLock = true;
      }
    } catch {
    hasActiveLock = false;
    }

  try {
    const result = await vault.withdraw(amountMicro);
    const txId = extractTxId(result);

    const historyEntry = makeWithdrawEntry(
      address,
      currentBlock,
      amountMicro,
      hasActiveLock, // wasEarlyWithdraw: true if there was an active lock
      txId
    );

    return { txId, historyEntry };
  } catch (err: unknown) {
    throw mapSdkError(err);
  }
}

/**
 * Fetch the current vault state + block height for a given address.
 * Used by the CLI and frontend to build BehaviorSignals context.
 */
export async function fetchVaultContext(
  vault: FlowVault,
  address: string
): Promise<{
  currentBlock: number;
  vaultState: Awaited<ReturnType<FlowVault["getVaultState"]>>;
  routingRules: Awaited<ReturnType<FlowVault["getRoutingRules"]>>;
}> {
  try {
    const [currentBlock, vaultState, routingRules] = await Promise.all([
      vault.getCurrentBlockHeight(address),
      vault.getVaultState(address),
      vault.getRoutingRules(address),
    ]);
    return { currentBlock, vaultState, routingRules };
  } catch (err: unknown) {
    throw mapSdkError(err);
  }
}

// ── Validation helpers ─────────────────────────────────────────────────────────

function validateRoutingPlan(
  plan: RoutingPlan,
  depositAmountMicro: string,
  currentBlock: number
): void {
  const deposit = BigInt(depositAmountMicro);
  const lockAmt = BigInt(plan.lockAmountMicro);
  const splitAmt = BigInt(plan.splitAmountMicro);

  // Validate amounts are non-negative bigints
  if (lockAmt < 0n) {
    throw new InvalidAmountError("lockAmountMicro must be non-negative.");
  }
  if (splitAmt < 0n) {
    throw new InvalidAmountError("splitAmountMicro must be non-negative.");
  }

  // Guard: splitAmount + lockAmount <= depositAmount
  // (contract aborts otherwise — per task §6 Troubleshooting "Deposit tx fails immediately")
  if (lockAmt + splitAmt > deposit) {
    throw new InvalidAmountError(
      `lockAmount (${lockAmt}) + splitAmount (${splitAmt}) = ${lockAmt + splitAmt} ` +
        `exceeds depositAmount (${deposit}). ` +
        "The FlowVault contract will abort this transaction. " +
        "Check that your policy's lockPercent + splitPercent <= 100."
    );
  }

  // lockUntilBlock must be a future block when lockAmount > 0
  if (lockAmt > 0n && plan.lockUntilBlock <= currentBlock) {
    throw new InvalidRoutingRuleError(
      `lockUntilBlock (${plan.lockUntilBlock}) must be greater than currentBlock (${currentBlock}) ` +
        "when lockAmount > 0. The engine computes lockUntilBlock as currentBlock + lockDurationBlocks."
    );
  }

  // splitAddress required whenever splitAmount > 0
  if (splitAmt > 0n && !plan.splitAddress) {
    throw new InvalidRoutingRuleError(
      "splitAmount > 0 but splitAddress is null. " +
        "Provide a recipient STX address in the policy's baseline.splitAddress."
    );
  }

  // Validate split address format if provided
  if (plan.splitAddress) {
    validateSTXAddress(plan.splitAddress);
  }
}

// ── SDK error mapping ─────────────────────────────────────────────────────────

/**
 * Map every typed SDK error to a specific user-facing message.
 * Per task §6: InvalidAmountError, InvalidAddressError, InvalidRoutingRuleError,
 * InvalidConfigurationError, ContractCallError, NetworkError, ParsingError.
 */
function mapSdkError(err: unknown): Error {
  if (err instanceof Error) {
    const name = err.name;
    const msg = err.message;

    // Already typed — re-wrap with user-facing message
    if (name === "InvalidAddressError") {
      return new InvalidAddressError(
        `Invalid address: ${msg}. Use a Stacks address (ST.../SP...).`
      );
    }
    if (name === "InvalidAmountError") {
      return new InvalidAmountError(
        `Invalid amount: ${msg}. All amounts must be positive integers (in micro-units).`
      );
    }
    if (name === "InvalidRoutingRuleError") {
      return new InvalidRoutingRuleError(
        `Invalid routing rule: ${msg}. Check your policy's lock and split configuration.`
      );
    }
    if (name === "InvalidConfigurationError") {
      return new InvalidRoutingRuleError(
        `Configuration error: ${msg}. Verify your FlowVault network and contract settings.`
      );
    }
    if (name === "ContractCallError") {
      return new ContractCallError(
        `Contract call failed: ${msg}. The transaction was rejected by the FlowVault contract.`
      );
    }
    if (name === "NetworkError" || msg.includes("fetch") || msg.includes("ECONNREFUSED")) {
      return new NetworkError(
        `Network error: ${msg}. Check your internet connection and Stacks testnet status.`
      );
    }
    if (name === "ParsingError" || msg.includes("JSON") || msg.includes("parse")) {
      return new ParsingError(
        `Failed to parse response: ${msg}. The node returned unexpected data.`
      );
    }

    // Generic fallback
    return new ContractCallError(`FlowVault error: ${msg}`);
  }

  return new ContractCallError(`Unknown FlowVault error: ${String(err)}`);
}

// ── Utility ───────────────────────────────────────────────────────────────────

function extractTxId(result: unknown): string {
if (result && typeof result === "object") {
const obj = result as Record<string, unknown>;

// TransactionResult has a `status` field: "success" means accepted into
// the mempool, "error" means it was NOT. A txId can be present and look
// completely valid even when status is "error" - the SDK computes the
// tx hash locally at signing time, before broadcast is even attempted.
// This is the actual root cause tonight: we were only checking for the
// presence of a txId, never checking whether the broadcast itself
// actually succeeded.
if ("status" in obj && obj.status === "error") {
  throw new Error(
    "Transaction was not accepted into the mempool (status: error). " +
    "Raw response: " + JSON.stringify(result)
  );
}

if (typeof obj.txId === "string" && obj.txId.length > 0) {
  return obj.txId;
}
if (typeof obj.txid === "string" && obj.txid.length > 0) {
  return obj.txid;
}

}

if (typeof result === "string" && result.length > 0) {
return result;
}

throw new Error(
"Could not extract a valid transaction id from the SDK response. " +
"Raw response: " + JSON.stringify(result) +
". This usually means the transaction was not actually broadcast " +
"successfully, even though the call did not throw."
);
}


