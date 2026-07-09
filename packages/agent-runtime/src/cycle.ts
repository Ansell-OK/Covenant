// packages/agent-runtime/src/cycle.ts
//
// One full agent cycle: fetch state, judge whether to act, and if so, run
// the same execute path proven by the CLI's `covenant run` command.
// Reuses createCliVault/executeDepositCycle/fetchVaultContext from
// @covenant/flowvault-adapter unchanged - no reimplementation of proven logic.
//
// Field names below are confirmed against flowvault-sdk's real VaultState
// interface (totalBalance, lockedBalance, unlockedBalance, lockUntilBlock,
// currentBlock, routingRules - all `number`, not bigint/string) and against
// executor.ts's real, positional-argument function signatures. Not guessed.

import type { PolicySpec } from "@covenant/core";
import { deriveBehaviorSignals, engine } from "@covenant/core";
import {
  createCliVault,
  executeDepositCycle,
  fetchVaultContext,
} from "@covenant/flowvault-adapter";
import { readHistory, appendHistory } from "../../covenant-core/src/history-node";
import { judge, type VaultSnapshot } from "./judge";

export interface CycleOptions {
  address: string;
  policy: PolicySpec;
  senderKey: string;
  depositAmountMicro: string;
  dryRun: boolean;
}

export interface CycleResult {
  ranAt: string;
  judgment: Awaited<ReturnType<typeof judge>>;
  acted: boolean;
  txIds?: { setRulesTxId: string; depositTxId: string };
  planSummary?: {
    lockAmountMicro: string;
    splitAmountMicro: string;
    lockUntilBlock: number;
    rationale: string;
  };
  error?: string;
}

export async function runCycle(opts: CycleOptions): Promise<CycleResult> {
  const ranAt = new Date().toISOString();
  const vault = createCliVault(opts.senderKey);

  try {
    const context = await fetchVaultContext(vault, opts.address);

    const snapshot: VaultSnapshot = {
      currentBlock: context.currentBlock,
      unlockedBalance: String(context.vaultState.unlockedBalance),
      lockedBalance: String(context.vaultState.lockedBalance),
      lockUntilBlock: context.vaultState.lockUntilBlock,
    };

    // TEMPORARY DEBUG LOG - remove once confirmed working
    console.log("RAW snapshot:", JSON.stringify(snapshot, null, 2));
    console.log("RAW context.vaultState (unmapped):", JSON.stringify(context.vaultState, null, 2));

    const history = readHistory(opts.address);
    const signals = deriveBehaviorSignals(history, context.currentBlock, opts.policy);

    const judgment = await judge(snapshot, signals, opts.policy);

    if (!judgment.shouldAct) {
      return { ranAt, judgment, acted: false };
    }

    const plan = engine(signals, opts.policy, opts.depositAmountMicro, context.currentBlock);

    const planSummary = {
      lockAmountMicro: plan.lockAmountMicro,
      splitAmountMicro: plan.splitAmountMicro,
      lockUntilBlock: plan.lockUntilBlock,
      rationale: plan.rationale,
    };

    if (opts.dryRun) {
      return { ranAt, judgment, acted: false, planSummary };
    }

    const execResult = await executeDepositCycle(
      vault,
      opts.address,
      plan,
      opts.depositAmountMicro,
      context.currentBlock
    );

    // appendHistory takes ONE HistoryLogEntry at a time, not an array or an
    // address+array pair - confirmed from the real history-node.ts source.
    // execResult.historyEntries is an array (setRoutingRules entry + deposit
    // entry), so append each one individually.
    for (const entry of execResult.historyEntries) {
      appendHistory(entry);
    }

    return {
      ranAt,
      judgment,
      acted: true,
      txIds: {
        setRulesTxId: execResult.setRulesTxId,
        depositTxId: execResult.depositTxId,
      },
      planSummary,
    };
  } catch (err) {
    return {
      ranAt,
      judgment: {
        shouldAct: false,
        reason: "Cycle aborted due to error.",
        provider: "local-rules",
        usedFallback: false,
      },
      acted: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}