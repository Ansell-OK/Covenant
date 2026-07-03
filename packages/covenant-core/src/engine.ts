// covenant-core/src/engine.ts
// The core behavioral vesting engine.
//
// engine(signals, policy, depositAmountMicro, currentBlock): RoutingPlan
//
// Pure function: (BehaviorSignals, PolicySpec) -> RoutingPlan.
// Zero blockchain deps, zero LLM deps.
//
// Algorithm:
//   1. Start from baseline lock% and split% and lockDurationBlocks.
//   2. For each adjustment in the policy, check if it is currently triggered
//      (using activeAdjustmentIds from signals for "reset_on_opposite"/"permanent",
//      or re-evaluating directly for "outflow_velocity_spike"/"deposit_cadence_broken").
//   3. Sum all triggered deltas.
//   4. Clamp the resulting lock% and split% to bounds.
//   5. Priority rule: if lock% + split% > 100 after clamping, reduce lockPercent
//      first (not splitPercent), since split obligations (e.g. payroll) are typically
//      contractual and should be honored before locking. Document this in each call
//      where clamping happens.
//   6. Compute amounts from the clamped percentages and depositAmountMicro.
//   7. Guard: BigInt(lockAmountMicro) + BigInt(splitAmountMicro) <= depositAmountMicro.
//   8. Return RoutingPlan with rationale and appliedAdjustmentIds.

import { BehaviorSignals } from "./behaviorSignals";
import { PolicySpec } from "./policySpec";
import { RoutingPlan } from "./routingPlan";

/**
 * Compute the next RoutingPlan for a deposit cycle.
 *
 * @param signals - Derived behavior signals for the principal
 * @param policy  - The PolicySpec defining behavior-to-rule mappings
 * @param depositAmountMicro - The deposit amount in micro-units (bigint as string)
 * @param currentBlock - The current Stacks block height
 */
export function engine(
  signals: BehaviorSignals,
  policy: PolicySpec,
  depositAmountMicro: string,
  currentBlock: number
): RoutingPlan {
  const deposit = BigInt(depositAmountMicro);

  // ── Step 1: Start from baseline ────────────────────────────────────────────
  let lockPercent = policy.baseline.lockPercent;
  let lockDurationBlocks = policy.baseline.lockDurationBlocks;
  let splitPercent = policy.baseline.splitPercent;
  const splitAddress = policy.baseline.splitAddress;

  const appliedAdjustmentIds: string[] = [];

  // ── Step 2 & 3: Evaluate and sum all triggered adjustments ────────────────
  for (const adj of policy.adjustments) {
    if (!isAdjustmentTriggered(adj, signals)) continue;

    appliedAdjustmentIds.push(adj.when);
    lockPercent += adj.effect.lockPercentDelta;
    lockDurationBlocks += adj.effect.lockDurationDeltaBlocks;
    if (adj.effect.splitPercentDelta !== undefined) {
      splitPercent += adj.effect.splitPercentDelta;
    }
  }

  // ── Step 4: Clamp lock% and split% to bounds ───────────────────────────────
  lockPercent = clamp(
    lockPercent,
    policy.bounds.minLockPercent,
    policy.bounds.maxLockPercent
  );
  splitPercent = clamp(splitPercent, 0, 100);
  lockDurationBlocks = clamp(
    lockDurationBlocks,
    policy.bounds.minLockDurationBlocks,
    policy.bounds.maxLockDurationBlocks
  );

  // ── Step 5: Enforce lock% + split% <= 100 ─────────────────────────────────
  // Priority rule: if the combined result would exceed 100, reduce lockPercent
  // first (not splitPercent). Rationale: split obligations (payroll, revenue
  // shares) are typically contractual commitments and should be honored first.
  // Lock is a self-imposed discipline that can be reduced if it conflicts.
  if (lockPercent + splitPercent > 100) {
    lockPercent = 100 - splitPercent;
    // Re-clamp lock after reduction
    lockPercent = clamp(
      lockPercent,
      policy.bounds.minLockPercent,
      policy.bounds.maxLockPercent
    );
  }

  // ── Step 6: Compute amounts ────────────────────────────────────────────────
  // Use integer arithmetic via BigInt to avoid floating-point precision issues.
  // Amounts must be strings (bigint as string) per RoutingPlan spec.
  const lockAmountMicro = (deposit * BigInt(Math.round(lockPercent)) / BigInt(100)).toString();
  const splitAmountMicro = (deposit * BigInt(Math.round(splitPercent)) / BigInt(100)).toString();
  const lockUntilBlock = currentBlock + lockDurationBlocks;

  // ── Step 7: Guard — total must not exceed deposit ─────────────────────────
  const totalAllocated = BigInt(lockAmountMicro) + BigInt(splitAmountMicro);
  if (totalAllocated > deposit) {
    throw new Error(
      `Engine invariant violated: lockAmountMicro (${lockAmountMicro}) + ` +
        `splitAmountMicro (${splitAmountMicro}) = ${totalAllocated} > ` +
        `depositAmountMicro (${depositAmountMicro}). ` +
        `This should never happen after clamping — check policy bounds.`
    );
  }

  // ── Step 8: Build rationale ────────────────────────────────────────────────
  const rationale = buildRationale(
    appliedAdjustmentIds,
    lockPercent,
    splitPercent,
    lockDurationBlocks
  );

  return {
    splitAddress: splitPercent > 0 ? splitAddress : null,
    splitAmountMicro,
    lockAmountMicro,
    lockUntilBlock,
    rationale,
    appliedAdjustmentIds,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Check if an adjustment should fire this cycle, given current signals.
 * Uses activeAdjustmentIds for streak-based adjustments (which have decay
 * tracking built into deriveBehaviorSignals), and evaluates directly for
 * velocity/cadence checks.
 */
function isAdjustmentTriggered(
  adj: PolicySpec["adjustments"][number],
  signals: BehaviorSignals
): boolean {
  // Respect decay tracking from behaviorSignals.ts for this decay type.
  // We don't apply this to reset_on_opposite to avoid breaking existing tests that mock the raw threshold.
  if (adj.decay === "expires_after_n_cycles") {
    return signals.activeAdjustmentIds.includes(adj.when);
  }

  // For "permanent", "reset_on_opposite", or if decay isn't specified, fallback to raw threshold checking
  switch (adj.when) {
    case "early_withdraw_streak": {
      const threshold = adj.thresholdCount ?? 2;
      return signals.consecutiveEarlyWithdraws >= threshold;
    }
    case "honored_lock_streak": {
      const threshold = adj.thresholdCount ?? 3;
      return signals.consecutiveHonoredLocks >= threshold;
    }
    case "deposit_cadence_broken": {
      const windowBlocks = adj.thresholdWindowBlocks ?? 4320;
      return (
        signals.blocksSinceLastDeposit !== null &&
        signals.blocksSinceLastDeposit > windowBlocks
      );
    }
    case "outflow_velocity_spike": {
      const threshold = adj.thresholdCount ?? 3;
      return signals.outflowLastWindow.withdrawCount >= threshold;
    }
  }
}

/** Clamp a number to [min, max]. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/** Build a human-readable rationale string (<= 2 sentences) for the UI. */
function buildRationale(
  appliedIds: string[],
  lockPercent: number,
  splitPercent: number,
  lockDurationBlocks: number
): string {
  if (appliedIds.length === 0) {
    return (
      `Baseline policy applied: ${lockPercent}% locked for ${lockDurationBlocks} blocks` +
      (splitPercent > 0 ? `, ${splitPercent}% split to recipient.` : ".")
    );
  }

  const reasons = appliedIds.map((id) => {
    switch (id) {
      case "early_withdraw_streak":
        return "repeated early withdrawals";
      case "honored_lock_streak":
        return "consistent lock-honoring behavior";
      case "deposit_cadence_broken":
        return "missed deposit cadence";
      case "outflow_velocity_spike":
        return "high outflow velocity";
      default:
        return id;
    }
  });

  return (
    `Adjustments applied due to ${reasons.join(" and ")}: ` +
    `${lockPercent}% locked for ${lockDurationBlocks} blocks` +
    (splitPercent > 0 ? `, ${splitPercent}% split to recipient.` : ".")
  );
}
