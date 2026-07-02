// covenant-core/src/behaviorSignals.ts
// BehaviorSignals type + deriveBehaviorSignals() pure function.
//
// This is the second most important type in the system (after PolicySpec).
// It is derived entirely from the HistoryLogEntry[] log — no blockchain call
// is made here. The adapter polls the chain to build HistoryLogEntry records;
// this file turns those records into structured behavior signals that the
// engine uses to compute a RoutingPlan.

import { HistoryLogEntry, sortChronological } from "./history";
import { PolicySpec } from "./policySpec";

export type BehaviorSignals = {
  address: string;
  asOfBlock: number;
  consecutiveEarlyWithdraws: number;   // resets to 0 on any honored (non-early) withdraw
  consecutiveHonoredLocks: number;     // resets to 0 on any early withdraw
  blocksSinceLastDeposit: number | null; // null if no prior deposit in history
  outflowLastWindow: {                 // sum of withdraws within a trailing window
    windowBlocks: number;
    totalMicroWithdrawn: string;       // bigint as string
    withdrawCount: number;
  };
  activeAdjustmentIds: string[];       // adjustment `when` values currently in effect, per decay rules
};

/**
 * deriveBehaviorSignals
 *
 * Pure function: walks entries in chronological order and computes streaks,
 * cadence, and outflow velocity.
 *
 * @param entries - HistoryLogEntry[] for a single address (must all share the same address)
 * @param currentBlock - the current block height on-chain
 * @param policy - the PolicySpec (used to determine outflow window + active adjustment tracking)
 * @returns BehaviorSignals
 */
export function deriveBehaviorSignals(
  entries: HistoryLogEntry[],
  currentBlock: number,
  policy: PolicySpec
): BehaviorSignals {
  const sorted = sortChronological(entries);

  // ── Streak computation ─────────────────────────────────────────────────────
  // Walk all withdraw events in order; update consecutive streak counters.
  // consecutiveEarlyWithdraws resets to 0 on any honored withdraw.
  // consecutiveHonoredLocks resets to 0 on any early withdraw.
  let consecutiveEarlyWithdraws = 0;
  let consecutiveHonoredLocks = 0;

  for (const entry of sorted) {
    if (entry.eventType !== "withdraw") continue;
    if (entry.wasEarlyWithdraw === true) {
      consecutiveEarlyWithdraws += 1;
      consecutiveHonoredLocks = 0;
    } else if (entry.wasEarlyWithdraw === false) {
      consecutiveHonoredLocks += 1;
      consecutiveEarlyWithdraws = 0;
    }
    // wasEarlyWithdraw === null should not happen for withdraw events,
    // but guard anyway by ignoring those entries.
  }

  // ── Last deposit cadence ───────────────────────────────────────────────────
  let blocksSinceLastDeposit: number | null = null;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].eventType === "deposit") {
      blocksSinceLastDeposit = currentBlock - sorted[i].blockHeight;
      break;
    }
  }

  // ── Outflow velocity (trailing window) ────────────────────────────────────
  // Determine the window size from the first outflow_velocity_spike adjustment
  // in the policy, defaulting to 144 blocks (~1 day at ~10 min/block).
  const velocityAdj = policy.adjustments.find(
    (a) => a.when === "outflow_velocity_spike"
  );
  const windowBlocks = velocityAdj?.thresholdWindowBlocks ?? 144;
  const windowStart = currentBlock - windowBlocks;

  let totalMicroWithdrawn = BigInt(0);
  let withdrawCount = 0;
  for (const entry of sorted) {
    if (
      entry.eventType === "withdraw" &&
      entry.blockHeight >= windowStart &&
      entry.amountMicro !== null
    ) {
      totalMicroWithdrawn += BigInt(entry.amountMicro);
      withdrawCount += 1;
    }
  }

  // ── Active adjustments (decay tracking) ───────────────────────────────────
  // An adjustment is "active" if its trigger condition was met at some point in
  // history AND its decay rule has not yet removed it.
  //
  // Decay rules:
  //   - "reset_on_opposite": removed when the opposite streak condition appears
  //     (e.g., early_withdraw_streak removed if consecutiveHonoredLocks > 0)
  //   - "permanent": never removed once triggered
  //   - "expires_after_n_cycles": removed after decayCycles setRoutingRules events
  //     have been appended to history since the adjustment was first triggered
  //
  // NOTE: Full cycle counting for "expires_after_n_cycles" requires a richer
  // history traversal. Here we count setRoutingRules events since the adjustment
  // was last triggered.
  const activeAdjustmentIds: string[] = [];

  for (const adj of policy.adjustments) {
    const triggered = wasAdjustmentEverTriggered(adj, sorted, currentBlock);
    if (!triggered) continue;

    switch (adj.decay) {
      case "reset_on_opposite": {
        const stillActive = isAdjustmentStillActive_resetOnOpposite(
          adj.when,
          consecutiveEarlyWithdraws,
          consecutiveHonoredLocks
        );
        if (stillActive) activeAdjustmentIds.push(adj.when);
        break;
      }
      case "permanent": {
        activeAdjustmentIds.push(adj.when);
        break;
      }
      case "expires_after_n_cycles": {
        const decayCycles = adj.decayCycles ?? 1;
        const stillActive = isAdjustmentStillActive_expiresAfterNCycles(
          adj,
          sorted,
          decayCycles
        );
        if (stillActive) activeAdjustmentIds.push(adj.when);
        break;
      }
    }
  }

  return {
    address: entries[0]?.address ?? "",
    asOfBlock: currentBlock,
    consecutiveEarlyWithdraws,
    consecutiveHonoredLocks,
    blocksSinceLastDeposit,
    outflowLastWindow: {
      windowBlocks,
      totalMicroWithdrawn: totalMicroWithdrawn.toString(),
      withdrawCount,
    },
    activeAdjustmentIds,
  };
}

// ── Internal helpers ───────────────────────────────────────────────────────────

/**
 * Check if an adjustment's threshold was ever met in the history log.
 * Used as the base condition before checking decay.
 */
function wasAdjustmentEverTriggered(
  adj: PolicySpec["adjustments"][number],
  sorted: HistoryLogEntry[],
  currentBlock: number
): boolean {
  switch (adj.when) {
    case "early_withdraw_streak": {
      const threshold = adj.thresholdCount ?? 2;
      let streak = 0;
      for (const e of sorted) {
        if (e.eventType !== "withdraw") continue;
        if (e.wasEarlyWithdraw === true) {
          streak++;
          if (streak >= threshold) return true;
        } else {
          streak = 0;
        }
      }
      return false;
    }
    case "honored_lock_streak": {
      const threshold = adj.thresholdCount ?? 3;
      let streak = 0;
      for (const e of sorted) {
        if (e.eventType !== "withdraw") continue;
        if (e.wasEarlyWithdraw === false) {
          streak++;
          if (streak >= threshold) return true;
        } else {
          streak = 0;
        }
      }
      return false;
    }
    case "deposit_cadence_broken": {
      const windowBlocks = adj.thresholdWindowBlocks ?? 4320;
      // Triggered if no deposit in the last windowBlocks blocks
      const windowStart = currentBlock - windowBlocks;
      const hasRecentDeposit = sorted.some(
        (e) => e.eventType === "deposit" && e.blockHeight >= windowStart
      );
      const hasAnyDeposit = sorted.some((e) => e.eventType === "deposit");
      // Only triggered if there IS prior history (not a fresh address)
      return hasAnyDeposit && !hasRecentDeposit;
    }
    case "outflow_velocity_spike": {
      // thresholdCount = number of withdraws within thresholdWindowBlocks
      // Triggered if withdrawCount >= thresholdCount within the window
      const threshold = adj.thresholdCount ?? 3;
      const windowBlocks = adj.thresholdWindowBlocks ?? 144;
      const windowStart = currentBlock - windowBlocks;
      const count = sorted.filter(
        (e) => e.eventType === "withdraw" && e.blockHeight >= windowStart
      ).length;
      return count >= threshold;
    }
  }
}

/**
 * For "reset_on_opposite" decay: check if the adjustment is still active
 * based on the current streak state.
 */
function isAdjustmentStillActive_resetOnOpposite(
  when: string,
  consecutiveEarlyWithdraws: number,
  consecutiveHonoredLocks: number
): boolean {
  if (when === "early_withdraw_streak") {
    // Reset when the opposite is true: any honored lock streak > 0
    return consecutiveHonoredLocks === 0;
  }
  if (when === "honored_lock_streak") {
    // Reset when the opposite is true: any early withdraw streak > 0
    return consecutiveEarlyWithdraws === 0;
  }
  // For cadence/velocity, "reset_on_opposite" means the condition is no longer
  // present in the current signals. Since we call wasAdjustmentEverTriggered
  // with current signals, if it doesn't trigger now, it's inactive.
  return true; // default: leave to wasAdjustmentEverTriggered
}

/**
 * For "expires_after_n_cycles" decay: count setRoutingRules events since
 * the adjustment was last triggered. If >= decayCycles, the adjustment expired.
 */
function isAdjustmentStillActive_expiresAfterNCycles(
  adj: PolicySpec["adjustments"][number],
  sorted: HistoryLogEntry[],
  decayCycles: number
): boolean {
  // Find the most recent point where the adjustment was triggered.
  // Count subsequent setRoutingRules events — if >= decayCycles, it's expired.
  // For simplicity, count all setRoutingRules events in history.
  // A more precise implementation would track the trigger block height.
  const setRulesEvents = sorted.filter(
    (e) => e.eventType === "setRoutingRules"
  );
  // If there have been decayCycles or more setRoutingRules events since the
  // adjustment was ever triggered, consider it expired.
  // (This is a conservative approximation; a production system would store
  // the trigger cycle index in a separate field.)
  return setRulesEvents.length < decayCycles;
}
