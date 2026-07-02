// policy-compiler/src/providers/local-rules.ts
// Deterministic keyword-to-adjustment parser.
//
// This is the zero-cost, zero-API-key fallback provider.
// It MUST be able to produce valid, schema-passing PolicySpecs from all
// 5 example English source strings in section 10 of the task spec.
//
// Keyword table (from task §7):
// ┌──────────────────────────────────────────────────┬────────────────────────────┬──────────────────┬────────────────────────────────────────────┐
// │ Trigger phrase                                   │ when                       │ default threshold│ default effect                             │
// ├──────────────────────────────────────────────────┼────────────────────────────┼──────────────────┼────────────────────────────────────────────┤
// │ "early withdraw", "withdraws early",             │ early_withdraw_streak       │ count=2          │ lockPercentDelta:+20, durationDelta:+720   │
// │ "drains immediately"                             │                            │                  │                                            │
// ├──────────────────────────────────────────────────┼────────────────────────────┼──────────────────┼────────────────────────────────────────────┤
// │ "never withdraws early", "honors the lock",      │ honored_lock_streak        │ count=3          │ lockPercentDelta:-15, durationDelta:-360   │
// │ "leaves it locked"                               │                            │                  │                                            │
// ├──────────────────────────────────────────────────┼────────────────────────────┼──────────────────┼────────────────────────────────────────────┤
// │ "stops depositing", "misses a deposit",          │ deposit_cadence_broken     │ windowBlocks=4320│ lockPercentDelta:+10, durationDelta:0      │
// │ "goes quiet"                                     │                            │ (~30 days)       │                                            │
// ├──────────────────────────────────────────────────┼────────────────────────────┼──────────────────┼────────────────────────────────────────────┤
// │ "outflow spikes", "large withdrawals",           │ outflow_velocity_spike     │ count=3,         │ lockPercentDelta:+25, durationDelta:+1440  │
// │ "draining the treasury"                          │                            │ window=144 (~1d) │                                            │
// └──────────────────────────────────────────────────┴────────────────────────────┴──────────────────┴────────────────────────────────────────────┘
//
// Block time assumption: ~144 blocks/day at ~10 min/block (Stacks average).
// This constant is documented here because actual Stacks block time varies;
// all day-to-block conversions use this constant for reproducibility.
// Days-to-blocks: days * 144.
//
// Baseline defaults (when nothing stated):
//   lockPercent: 50, lockDurationBlocks: 4320 (~30 days), splitAddress: null, splitPercent: 0
//
// Bounds defaults:
//   minLockPercent: 0, maxLockPercent: 90,
//   minLockDurationBlocks: 144 (~1 day),
//   maxLockDurationBlocks: 52560 (~1 year)

import { PolicySpec, PolicySpecSchema } from "@covenant/core";

/** Blocks per day (at ~10 min/block on Stacks). Documented constant. */
const BLOCKS_PER_DAY = 144;

/** STX/SP address regex — matches ST.../SP... testnet/mainnet addresses */
const STX_ADDRESS_RE = /\b(ST|SP)[A-Z0-9]{38,40}\b/;

/** Percent extraction: number immediately followed by % */
const PERCENT_RE = /(\d+(?:\.\d+)?)\s*%/g;

/** Day extraction: number followed by "day" or "days" */
const DAYS_RE = /(\d+)\s*days?/gi;

/** Block extraction: number followed by "block" or "blocks" */
const BLOCKS_RE = /(\d+)\s*blocks?/gi;

export interface LocalRulesWarning {
  message: string;
}

export interface LocalRulesResult {
  policy: PolicySpec;
  warnings: LocalRulesWarning[];
}

/**
 * Parse plain-English policy text into a valid PolicySpec.
 * Deterministic — same input always produces the same output.
 * Zero API key required.
 *
 * @param text - Plain-English policy description
 * @param policyName - Optional name for the resulting PolicySpec
 */
export function compileLocalRules(
  text: string,
  policyName = "compiled-policy"
): LocalRulesResult {
  const lower = text.toLowerCase();
  const warnings: LocalRulesWarning[] = [];

  // ── Extract baseline lock percent ────────────────────────────────────────
  // Look for "lock N%" near the start of the text
  const percentMatches = [...text.matchAll(PERCENT_RE)];
  let lockPercent = 50; // default
  let splitPercent = 0; // default

  // Find the first % mentioned — treat as lockPercent if "lock" appears nearby
  // Find the second % if "split" or "send" appears nearby
  for (const match of percentMatches) {
    const pct = parseFloat(match[1]);
    const idx = match.index ?? 0;
    const context = lower.slice(Math.max(0, idx - 30), idx + 20);
    if (
      context.includes("split") ||
      context.includes("send") ||
      context.includes("payout") ||
      context.includes("recipient") ||
      context.includes("contributor")
    ) {
      splitPercent = pct;
    } else if (context.includes("lock") || context.includes("keep")) {
      lockPercent = pct;
    }
  }

  // ── Extract baseline lock duration ───────────────────────────────────────
  let lockDurationBlocks = 4320; // default: ~30 days

  const daysMatches = [...text.matchAll(DAYS_RE)];
  const blocksMatches = [...text.matchAll(BLOCKS_RE)];

  if (daysMatches.length > 0) {
    // Use the first day mention near "lock" as the lock duration
    const days = parseInt(daysMatches[0][1], 10);
    lockDurationBlocks = days * BLOCKS_PER_DAY;
  } else if (blocksMatches.length > 0) {
    lockDurationBlocks = parseInt(blocksMatches[0][1], 10);
  }

  // ── Extract split address ────────────────────────────────────────────────
  const addrMatch = text.match(STX_ADDRESS_RE);
  let splitAddress: string | null = addrMatch ? addrMatch[0] : null;

  if (splitPercent > 0 && splitAddress === null) {
    warnings.push({
      message:
        "Split percent given but no STX/SP address found in policy text. " +
        'Set splitAddress manually or add an "ST..." address to the text.',
    });
  }

  // If lockPercent = 0 and splitPercent > 0, this is a split-only policy
  // If both are 0, this is a hold-only policy
  if (percentMatches.length === 0) {
    // No percentages mentioned — check for split-only hints
    if (
      lower.includes("split") ||
      lower.includes("send") ||
      lower.includes("payout")
    ) {
      lockPercent = 0;
    }
  }

  // ── Parse adjustments ────────────────────────────────────────────────────
  const adjustments: PolicySpec["adjustments"] = [];

  // --- early_withdraw_streak ---
  if (
    lower.includes("early withdraw") ||
    lower.includes("withdraws early") ||
    lower.includes("drains immediately") ||
    lower.includes("withdraw early")
  ) {
    // Check for "never withdraws early" (honored_lock_streak phrase) — don't double-count
    const isNegated =
      lower.includes("never withdraws early") ||
      lower.includes("not withdraw early");

    if (!isNegated) {
      // Try to extract a custom threshold count from text like "twice in a row", "2 times"
      const thresholdMatch =
        lower.match(/(\d+)\s+(?:times?|consecutive|in a row)/) ??
        lower.match(/(\d+)\s+times? in a row/);
      const thresholdCount = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 2;

      // Try to extract custom lock delta from phrases like "lock 70%", "lock N% for M days"
      const adj: PolicySpec["adjustments"][number] = {
        when: "early_withdraw_streak",
        thresholdCount,
        effect: {
          lockPercentDelta: 20,       // default from table
          lockDurationDeltaBlocks: 720, // ~5 days default
        },
        decay: "reset_on_opposite",
      };

      // Look for "until they go back to honoring" → implies reset_on_opposite (already default)
      // Look for "for N days" in the context of the punishment
      const punishDaysMatch = lower.match(/(?:lock|locked)\s+\d+%\s+for\s+(\d+)\s+days?/);
      if (punishDaysMatch) {
        const punishDays = parseInt(punishDaysMatch[1], 10);
        const punishBlocks = punishDays * BLOCKS_PER_DAY;
        adj.effect.lockDurationDeltaBlocks = punishBlocks - lockDurationBlocks;
      }

      // Look for punishment percent "lock 70%" or "tighten to 80%"
      const punishPctMatch = lower.match(
        /(?:withdraw|early).*?(?:lock|locked|tighten|increase|to|up to)\s+(\d+)%/
      ) ?? lower.match(
        /(?:lock|locked|tighten|increase|to|up to)\s+(\d+)%.*?(?:withdraw|early)/
      );
      if (punishPctMatch) {
        const punishPct = parseInt(punishPctMatch[1], 10);
        adj.effect.lockPercentDelta = punishPct - lockPercent;
      }

      adjustments.push(adj);
    }
  }

  // --- honored_lock_streak ---
  if (
    lower.includes("never withdraws early") ||
    lower.includes("honors the lock") ||
    lower.includes("leaves it locked") ||
    lower.includes("honoring lock") ||
    lower.includes("honor") && lower.includes("lock") ||
    lower.includes("honored lock") ||
    lower.includes("go back to honoring")
  ) {
    const thresholdMatch = lower.match(/(\d+)\s+(?:honored|consecutive|in a row)/);
    const thresholdCount = thresholdMatch ? parseInt(thresholdMatch[1], 10) : 3;

    adjustments.push({
      when: "honored_lock_streak",
      thresholdCount,
      effect: {
        lockPercentDelta: -15,          // default: ease up
        lockDurationDeltaBlocks: -360,  // ~2.5 days
      },
      decay: "reset_on_opposite",
    });
  }

  // --- deposit_cadence_broken ---
  if (
    lower.includes("stops depositing") ||
    lower.includes("misses a deposit") ||
    lower.includes("goes quiet") ||
    lower.includes("no deposit")
  ) {
    adjustments.push({
      when: "deposit_cadence_broken",
      thresholdWindowBlocks: 4320, // ~30 days
      effect: {
        lockPercentDelta: 10,
        lockDurationDeltaBlocks: 0,
      },
      decay: "permanent",
    });
  }

  // --- outflow_velocity_spike ---
  if (
    lower.includes("outflow spikes") ||
    lower.includes("large withdrawals") ||
    lower.includes("draining the treasury") ||
    lower.includes("large withdrawal")
  ) {
    const countMatch = lower.match(/(\d+)\+?\s+(?:large|withdrawals?)/);
    const thresholdCount = countMatch ? parseInt(countMatch[1], 10) : 3;

    // Look for "in a single day" → 144 blocks; otherwise default
    const windowBlocks = lower.includes("single day")
      ? 144
      : lower.includes("day")
      ? 144
      : 144;

    // Look for cycle count like "next two cycles"
    const cycleMatch = lower.match(/next\s+(\w+)\s+cycles?/);
    let decayCycles = 2;
    if (cycleMatch) {
      const word = cycleMatch[1];
      const map: Record<string, number> = {
        one: 1, two: 2, three: 3, four: 4, five: 5,
      };
      decayCycles = (map[word] ?? parseInt(word, 10)) || 2;
    }

    adjustments.push({
      when: "outflow_velocity_spike",
      thresholdCount,
      thresholdWindowBlocks: windowBlocks,
      effect: {
        lockPercentDelta: 25,
        lockDurationDeltaBlocks: 1440, // ~10 days
      },
      decay: "expires_after_n_cycles",
      decayCycles,
    });
  }

  // ── If it's a lock-only policy (no split mentions, no split address) ─────
  if (
    lower.includes("keep the rest liquid") ||
    lower.includes("keep it all liquid") ||
    lower.includes("don't lock") ||
    lower.includes("do not lock")
  ) {
    lockPercent = 0;
  }

  // ── Build baseline & bounds ───────────────────────────────────────────────
  const baseline: PolicySpec["baseline"] = {
    lockPercent,
    lockDurationBlocks,
    splitAddress,
    splitPercent,
  };

  const bounds: PolicySpec["bounds"] = {
    minLockPercent: 0,
    maxLockPercent: 90,
    minLockDurationBlocks: 144,   // 1 day minimum
    maxLockDurationBlocks: 52560, // ~1 year maximum
  };

  // ── Validate against schema ───────────────────────────────────────────────
  const raw = { name: policyName, baseline, adjustments, bounds };
  const parsed = PolicySpecSchema.parse(raw);

  return { policy: parsed, warnings };
}
