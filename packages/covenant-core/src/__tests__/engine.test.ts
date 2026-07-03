// covenant-core/src/__tests__/engine.test.ts
// Table-driven tests for all 10 scenarios from task section 5.
// Zero blockchain or LLM imports — this is the verification gate for covenant-core.

import { describe, it, expect } from "vitest";
import { engine } from "../engine";
import { BehaviorSignals } from "../behaviorSignals";
import { PolicySpec } from "../policySpec";
import { RoutingPlan } from "../routingPlan";

// ── Shared fixtures ────────────────────────────────────────────────────────────

const CURRENT_BLOCK = 100_000;
const DEPOSIT = "1000000"; // 1,000,000 micro units

/** Default baseline used by most tests */
const baselinePolicy: PolicySpec = {
  name: "test-baseline",
  baseline: {
    lockPercent: 50,
    lockDurationBlocks: 1000,
    splitAddress: null,
    splitPercent: 0,
  },
  adjustments: [],
  bounds: {
    minLockPercent: 0,
    maxLockPercent: 90,
    minLockDurationBlocks: 100,
    maxLockDurationBlocks: 10000,
  },
};

/** Fresh principal with no history */
const freshSignals: BehaviorSignals = {
  address: "ST1FRESH",
  asOfBlock: CURRENT_BLOCK,
  consecutiveEarlyWithdraws: 0,
  consecutiveHonoredLocks: 0,
  blocksSinceLastDeposit: null,
  outflowLastWindow: {
    windowBlocks: 144,
    totalMicroWithdrawn: "0",
    withdrawCount: 0,
  },
  activeAdjustmentIds: [],
};

// ── Scenario 1: Fresh principal, no history → baseline applied exactly ─────────
describe("Scenario 1: Fresh principal, no history", () => {
  it("applies baseline plan exactly with no adjustments", () => {
    const plan = engine(freshSignals, baselinePolicy, DEPOSIT, CURRENT_BLOCK);

    expect(plan.appliedAdjustmentIds).toEqual([]);
    expect(plan.lockAmountMicro).toBe("500000");  // 50% of 1,000,000
    expect(plan.splitAmountMicro).toBe("0");
    expect(plan.lockUntilBlock).toBe(CURRENT_BLOCK + 1000);
    expect(plan.splitAddress).toBeNull();
    expect(BigInt(plan.lockAmountMicro) + BigInt(plan.splitAmountMicro))
      .toBeLessThanOrEqual(BigInt(DEPOSIT));
  });
});

// ── Scenario 2: early_withdraw_streak meets thresholdCount ────────────────────
describe("Scenario 2: early_withdraw_streak, thresholdCount=2 met", () => {
  const policy: PolicySpec = {
    ...baselinePolicy,
    name: "test-early-withdraw",
    adjustments: [
      {
        when: "early_withdraw_streak",
        thresholdCount: 2,
        effect: { lockPercentDelta: 20, lockDurationDeltaBlocks: 500 },
        decay: "reset_on_opposite",
      },
    ],
  };

  const signals: BehaviorSignals = {
    ...freshSignals,
    consecutiveEarlyWithdraws: 2,
    consecutiveHonoredLocks: 0,
  };

  it("applies early_withdraw_streak adjustment, clamped to bounds", () => {
    const plan = engine(signals, policy, DEPOSIT, CURRENT_BLOCK);

    expect(plan.appliedAdjustmentIds).toContain("early_withdraw_streak");
    // 50 + 20 = 70%, within bounds [0, 90]
    expect(plan.lockAmountMicro).toBe("700000");
    expect(plan.lockUntilBlock).toBe(CURRENT_BLOCK + 1500); // 1000 + 500
    expect(BigInt(plan.lockAmountMicro) + BigInt(plan.splitAmountMicro))
      .toBeLessThanOrEqual(BigInt(DEPOSIT));
  });
});

// ── Scenario 3: honored_lock_streak meets thresholdCount → loosening ─────────
describe("Scenario 3: honored_lock_streak, thresholdCount=3 met", () => {
  const policy: PolicySpec = {
    ...baselinePolicy,
    name: "test-honored-lock",
    baseline: { ...baselinePolicy.baseline, lockPercent: 60, lockDurationBlocks: 2000 },
    adjustments: [
      {
        when: "honored_lock_streak",
        thresholdCount: 3,
        effect: { lockPercentDelta: -25, lockDurationDeltaBlocks: -1000 },
        decay: "reset_on_opposite",
      },
    ],
  };

  const signals: BehaviorSignals = {
    ...freshSignals,
    consecutiveHonoredLocks: 3,
    consecutiveEarlyWithdraws: 0,
  };

  it("applies loosening effect from honored_lock_streak", () => {
    const plan = engine(signals, policy, DEPOSIT, CURRENT_BLOCK);

    expect(plan.appliedAdjustmentIds).toContain("honored_lock_streak");
    // 60 - 25 = 35%
    expect(plan.lockAmountMicro).toBe("350000");
    expect(plan.lockUntilBlock).toBe(CURRENT_BLOCK + 1000); // 2000 - 1000
    expect(BigInt(plan.lockAmountMicro) + BigInt(plan.splitAmountMicro))
      .toBeLessThanOrEqual(BigInt(DEPOSIT));
  });
});

// ── Scenario 4: Streak broke, reset_on_opposite → reverts to baseline ────────
describe("Scenario 4: early_withdraw_streak reset (decay=reset_on_opposite)", () => {
  const policy: PolicySpec = {
    ...baselinePolicy,
    name: "test-reset",
    adjustments: [
      {
        when: "early_withdraw_streak",
        thresholdCount: 2,
        effect: { lockPercentDelta: 20, lockDurationDeltaBlocks: 500 },
        decay: "reset_on_opposite",
      },
    ],
  };

  // Signals: streak JUST broke — consecutiveEarlyWithdraws reset to 0
  // (a honored withdraw happened, resetting the streak)
  const signals: BehaviorSignals = {
    ...freshSignals,
    consecutiveEarlyWithdraws: 0,  // streak broke
    consecutiveHonoredLocks: 1,    // opposite condition appeared
  };

  it("does NOT apply the adjustment — reverts to baseline", () => {
    const plan = engine(signals, policy, DEPOSIT, CURRENT_BLOCK);

    expect(plan.appliedAdjustmentIds).not.toContain("early_withdraw_streak");
    // Back to baseline: 50%
    expect(plan.lockAmountMicro).toBe("500000");
    expect(plan.lockUntilBlock).toBe(CURRENT_BLOCK + 1000);
  });
});

// ── Scenario 5: deposit_cadence_broken ────────────────────────────────────────
describe("Scenario 5: deposit_cadence_broken", () => {
  const policy: PolicySpec = {
    ...baselinePolicy,
    name: "test-cadence",
    adjustments: [
      {
        when: "deposit_cadence_broken",
        thresholdWindowBlocks: 4320,
        effect: { lockPercentDelta: 10, lockDurationDeltaBlocks: 0 },
        decay: "permanent",
      },
    ],
  };

  const signals: BehaviorSignals = {
    ...freshSignals,
    blocksSinceLastDeposit: 5000, // > 4320 threshold window
  };

  it("applies deposit_cadence_broken adjustment", () => {
    const plan = engine(signals, policy, DEPOSIT, CURRENT_BLOCK);

    expect(plan.appliedAdjustmentIds).toContain("deposit_cadence_broken");
    // 50 + 10 = 60%
    expect(plan.lockAmountMicro).toBe("600000");
    expect(BigInt(plan.lockAmountMicro) + BigInt(plan.splitAmountMicro))
      .toBeLessThanOrEqual(BigInt(DEPOSIT));
  });

  it("does NOT apply when cadence is fine (blocksSinceLastDeposit < window)", () => {
    const signals2: BehaviorSignals = { ...signals, blocksSinceLastDeposit: 1000 };
    const plan = engine(signals2, policy, DEPOSIT, CURRENT_BLOCK);

    expect(plan.appliedAdjustmentIds).not.toContain("deposit_cadence_broken");
    expect(plan.lockAmountMicro).toBe("500000");
  });
});

// ── Scenario 6: outflow_velocity_spike ────────────────────────────────────────
// thresholdCount = number of withdraws within thresholdWindowBlocks (per task §5 note)
describe("Scenario 6: outflow_velocity_spike", () => {
  const policy: PolicySpec = {
    ...baselinePolicy,
    name: "test-velocity",
    adjustments: [
      {
        when: "outflow_velocity_spike",
        thresholdCount: 3,          // 3+ withdraws within the window
        thresholdWindowBlocks: 144, // ~1 day
        effect: { lockPercentDelta: 25, lockDurationDeltaBlocks: 1440 },
        decay: "expires_after_n_cycles",
        decayCycles: 2,
      },
    ],
  };

  const signals: BehaviorSignals = {
    ...freshSignals,
    outflowLastWindow: {
      windowBlocks: 144,
      totalMicroWithdrawn: "500000",
      withdrawCount: 3, // exactly at threshold
    },
    activeAdjustmentIds: ["outflow_velocity_spike"],
  };

  it("applies outflow_velocity_spike when withdrawCount >= thresholdCount", () => {
    const plan = engine(signals, policy, DEPOSIT, CURRENT_BLOCK);

    expect(plan.appliedAdjustmentIds).toContain("outflow_velocity_spike");
    // 50 + 25 = 75%
    expect(plan.lockAmountMicro).toBe("750000");
    expect(plan.lockUntilBlock).toBe(CURRENT_BLOCK + 2440); // 1000 + 1440
    expect(BigInt(plan.lockAmountMicro) + BigInt(plan.splitAmountMicro))
      .toBeLessThanOrEqual(BigInt(DEPOSIT));
  });

  it("does NOT apply when withdrawCount < thresholdCount", () => {
    const signals2: BehaviorSignals = {
      ...signals,
      outflowLastWindow: { ...signals.outflowLastWindow, withdrawCount: 2 },
      activeAdjustmentIds: [],
    };
    const plan = engine(signals2, policy, DEPOSIT, CURRENT_BLOCK);
    expect(plan.appliedAdjustmentIds).not.toContain("outflow_velocity_spike");
  });
});

// ── Scenario 7: Two adjustments both eligible simultaneously ──────────────────
// Deltas sum, clamp to bounds, assert lockPercent + splitPercent <= 100
describe("Scenario 7: Two adjustments triggered simultaneously", () => {
  const policy: PolicySpec = {
    ...baselinePolicy,
    name: "test-dual",
    baseline: { ...baselinePolicy.baseline, lockPercent: 40 },
    adjustments: [
      {
        when: "early_withdraw_streak",
        thresholdCount: 2,
        effect: { lockPercentDelta: 30, lockDurationDeltaBlocks: 500 },
        decay: "reset_on_opposite",
      },
      {
        when: "outflow_velocity_spike",
        thresholdCount: 3,
        thresholdWindowBlocks: 144,
        effect: { lockPercentDelta: 30, lockDurationDeltaBlocks: 500 },
        decay: "expires_after_n_cycles",
        decayCycles: 2,
      },
    ],
    bounds: {
      minLockPercent: 0,
      maxLockPercent: 90,
      minLockDurationBlocks: 100,
      maxLockDurationBlocks: 10000,
    },
  };

  const signals: BehaviorSignals = {
    ...freshSignals,
    consecutiveEarlyWithdraws: 2,
    outflowLastWindow: {
      windowBlocks: 144,
      totalMicroWithdrawn: "500000",
      withdrawCount: 3,
    },
    activeAdjustmentIds: ["early_withdraw_streak", "outflow_velocity_spike"],
  };

  it("sums deltas, clamps to maxLockPercent=90, and keeps lockPercent+splitPercent<=100", () => {
    const plan = engine(signals, policy, DEPOSIT, CURRENT_BLOCK);

    expect(plan.appliedAdjustmentIds).toContain("early_withdraw_streak");
    expect(plan.appliedAdjustmentIds).toContain("outflow_velocity_spike");

    const lockPct = Number(BigInt(plan.lockAmountMicro) * 100n / BigInt(DEPOSIT));
    const splitPct = Number(BigInt(plan.splitAmountMicro) * 100n / BigInt(DEPOSIT));

    // 40 + 30 + 30 = 100, clamped to maxLockPercent 90
    expect(lockPct).toBe(90);
    expect(lockPct + splitPct).toBeLessThanOrEqual(100);
    expect(BigInt(plan.lockAmountMicro) + BigInt(plan.splitAmountMicro))
      .toBeLessThanOrEqual(BigInt(DEPOSIT));
  });
});

// ── Scenario 8: Split-only policy ─────────────────────────────────────────────
describe("Scenario 8: Split-only policy (lockPercent=0)", () => {
  const policy: PolicySpec = {
    name: "test-split-only",
    baseline: {
      lockPercent: 0,
      lockDurationBlocks: 144,
      splitAddress: "ST1RECIPIENT00000000000000000000000000",
      splitPercent: 20,
    },
    adjustments: [],
    bounds: {
      minLockPercent: 0,
      maxLockPercent: 90,
      minLockDurationBlocks: 144,
      maxLockDurationBlocks: 52560,
    },
  };

  it("returns lockAmountMicro='0' and correct splitAmountMicro", () => {
    const plan = engine(freshSignals, policy, DEPOSIT, CURRENT_BLOCK);

    expect(plan.lockAmountMicro).toBe("0");
    expect(plan.splitAmountMicro).toBe("200000"); // 20% of 1,000,000
    expect(plan.splitAddress).toBe("ST1RECIPIENT00000000000000000000000000");
    expect(plan.appliedAdjustmentIds).toEqual([]);
    expect(BigInt(plan.lockAmountMicro) + BigInt(plan.splitAmountMicro))
      .toBeLessThanOrEqual(BigInt(DEPOSIT));
  });
});

// ── Scenario 9: Lock-only policy ──────────────────────────────────────────────
describe("Scenario 9: Lock-only policy (splitPercent=0, splitAddress=null)", () => {
  const policy: PolicySpec = {
    name: "test-lock-only",
    baseline: {
      lockPercent: 70,
      lockDurationBlocks: 2000,
      splitAddress: null,
      splitPercent: 0,
    },
    adjustments: [],
    bounds: {
      minLockPercent: 0,
      maxLockPercent: 90,
      minLockDurationBlocks: 144,
      maxLockDurationBlocks: 52560,
    },
  };

  it("returns splitAmountMicro='0' and splitAddress=null", () => {
    const plan = engine(freshSignals, policy, DEPOSIT, CURRENT_BLOCK);

    expect(plan.splitAmountMicro).toBe("0");
    expect(plan.splitAddress).toBeNull();
    expect(plan.lockAmountMicro).toBe("700000"); // 70%
    expect(BigInt(plan.lockAmountMicro) + BigInt(plan.splitAmountMicro))
      .toBeLessThanOrEqual(BigInt(DEPOSIT));
  });
});

// ── Scenario 10: Hold-only baseline, lock appears only as punishment ──────────
// Demonstrates: hold (lockPercent=0, splitPercent=0) as the true default,
// with lock appearing only when early_withdraw_streak fires.
describe("Scenario 10: Hold-only baseline, lock only on bad behavior", () => {
  const policy: PolicySpec = {
    name: "test-hold-until-trust",
    baseline: {
      lockPercent: 0,
      lockDurationBlocks: 144,
      splitAddress: null,
      splitPercent: 0,
    },
    adjustments: [
      {
        when: "early_withdraw_streak",
        thresholdCount: 1, // triggers after just ONE early withdraw
        effect: { lockPercentDelta: 40, lockDurationDeltaBlocks: 1440 },
        decay: "reset_on_opposite",
      },
    ],
    bounds: {
      minLockPercent: 0,
      maxLockPercent: 90,
      minLockDurationBlocks: 144,
      maxLockDurationBlocks: 52560,
    },
  };

  it("holds everything (lockAmount=0) when behavior is clean", () => {
    const plan = engine(freshSignals, policy, DEPOSIT, CURRENT_BLOCK);

    expect(plan.lockAmountMicro).toBe("0");
    expect(plan.splitAmountMicro).toBe("0");
    expect(plan.appliedAdjustmentIds).toEqual([]);
  });

  it("locks 40% when one early withdraw has occurred", () => {
    const signals: BehaviorSignals = {
      ...freshSignals,
      consecutiveEarlyWithdraws: 1,
      consecutiveHonoredLocks: 0,
    };
    const plan = engine(signals, policy, DEPOSIT, CURRENT_BLOCK);

    expect(plan.appliedAdjustmentIds).toContain("early_withdraw_streak");
    expect(plan.lockAmountMicro).toBe("400000"); // 0 + 40 = 40%
    expect(plan.lockUntilBlock).toBe(CURRENT_BLOCK + 1584); // 144 + 1440
    expect(BigInt(plan.lockAmountMicro) + BigInt(plan.splitAmountMicro))
      .toBeLessThanOrEqual(BigInt(DEPOSIT));
  });
});

// ── Regression Test for Fix 1 ────────────────────────────────────────────────
describe("Regression Test: expires_after_n_cycles decay is respected", () => {
  const policy: PolicySpec = {
    ...baselinePolicy,
    name: "test-decay",
    adjustments: [
      {
        when: "outflow_velocity_spike",
        thresholdCount: 3,
        thresholdWindowBlocks: 144,
        effect: { lockPercentDelta: 25, lockDurationDeltaBlocks: 1440 },
        decay: "expires_after_n_cycles",
        decayCycles: 2,
      },
    ],
  };

  const signals: BehaviorSignals = {
    ...freshSignals,
    outflowLastWindow: {
      windowBlocks: 144,
      totalMicroWithdrawn: "500000",
      withdrawCount: 3, // raw condition is STILL TRUE
    },
    // Crucially, activeAdjustmentIds does NOT include it because it decayed
    activeAdjustmentIds: [],
  };

  it("does NOT apply adjustment if decay logic removed it from activeAdjustmentIds (even if raw condition true)", () => {
    const plan = engine(signals, policy, DEPOSIT, CURRENT_BLOCK);
    
    expect(plan.appliedAdjustmentIds).not.toContain("outflow_velocity_spike");
    // Should fall back to baseline 50%
    expect(plan.lockAmountMicro).toBe("500000");
  });
});
