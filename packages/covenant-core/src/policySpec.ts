// covenant-core/src/policySpec.ts
// Zod schema for the generic "behavior -> rule" configuration format.
// This is the single config object that makes Covenant generic across
// payroll/vesting, savings, treasury, and creator revenue use cases.
// The engine (engine.ts) runs the same algorithm for every use case;
// only the PolicySpec values differ.

import { z } from "zod";

export const PolicySpecSchema = z.object({
  name: z.string(),
  baseline: z.object({
    lockPercent: z.number().min(0).max(100),           // % of new deposit to lock
    lockDurationBlocks: z.number().int().positive(),    // how long to lock (in blocks)
    splitAddress: z.string().nullable(),                // STX/SP address, or null
    splitPercent: z.number().min(0).max(100),           // % of new deposit to split off
  }),
  adjustments: z.array(
    z.object({
      when: z.enum([
        "early_withdraw_streak",
        "honored_lock_streak",
        "deposit_cadence_broken",
        "outflow_velocity_spike",
      ]),
      thresholdCount: z
        .number()
        .int()
        .positive()
        .optional(), // e.g. 2 consecutive early withdraws
      thresholdWindowBlocks: z
        .number()
        .int()
        .positive()
        .optional(), // for velocity/cadence checks
      effect: z.object({
        lockPercentDelta: z.number(),          // applied to baseline, then clamped to bounds
        lockDurationDeltaBlocks: z.number(),
        splitPercentDelta: z.number().optional(),
      }),
      decay: z.enum([
        "reset_on_opposite",
        "permanent",
        "expires_after_n_cycles",
      ]),
      decayCycles: z
        .number()
        .int()
        .positive()
        .optional(), // required when decay === "expires_after_n_cycles"
    })
  ),
  bounds: z.object({
    minLockPercent: z.number().min(0).max(100),
    maxLockPercent: z.number().min(0).max(100),
    minLockDurationBlocks: z.number().int().positive(),
    maxLockDurationBlocks: z.number().int().positive(),
  }),
});

export type PolicySpec = z.infer<typeof PolicySpecSchema>;
