// covenant-core/src/history.ts
// HistoryLogEntry schema + PURE (browser-safe) helpers only.
//
// FILE I/O (Node.js fs/path) has been deliberately separated into history-node.ts
// so that this file is safe to import in both browser and Node.js contexts.
//
// IMPORTANT: Do NOT import 'fs' or 'path' here — this file runs in the browser.
//
// CLI consumers: import { readHistory, appendHistory, writeHistory } from "./history-node"
// Frontend consumers: use the pure helpers here + manage state in memory/localStorage
//
// State resets on file deletion — documented in DEMO.md as "reset history for a clean demo run."

export type HistoryLogEntry = {
  address: string;
  blockHeight: number;
  timestampIso: string;
  eventType: "deposit" | "withdraw" | "setRoutingRules";
  amountMicro: string | null;   // bigint as string; null for setRoutingRules events
  /**
   * For withdraw events: true if this withdraw happened while the vault had any
   * locked balance with a future lockUntilBlock (i.e. the lock period was still active).
   *
   * Design decision on "early withdraw" definition:
   * A withdraw is marked wasEarlyWithdraw=true if, at the time of the withdraw,
   * the vault's active routing rules showed lockUntilBlock > currentBlock AND
   * lockAmount > 0. Withdrawing only unlocked balance while a lock is still active
   * is NOT counted as early. The contract prevents withdrawing locked funds directly,
   * so this flag is set when the user clears routing rules and then withdraws during
   * what would have been a lock period — i.e. they deliberately broke the lock intent.
   *
   * null for deposit/setRoutingRules events.
   */
  wasEarlyWithdraw: boolean | null;
  txId: string;
};

// ── Pure factory helpers (browser-safe) ────────────────────────────────────────

export function makeDepositEntry(
  address: string,
  blockHeight: number,
  amountMicro: string,
  txId: string
): HistoryLogEntry {
  return {
    address,
    blockHeight,
    timestampIso: new Date().toISOString(),
    eventType: "deposit",
    amountMicro,
    wasEarlyWithdraw: null,
    txId,
  };
}

export function makeWithdrawEntry(
  address: string,
  blockHeight: number,
  amountMicro: string,
  wasEarlyWithdraw: boolean,
  txId: string
): HistoryLogEntry {
  return {
    address,
    blockHeight,
    timestampIso: new Date().toISOString(),
    eventType: "withdraw",
    amountMicro,
    wasEarlyWithdraw,
    txId,
  };
}

export function makeSetRoutingRulesEntry(
  address: string,
  blockHeight: number,
  txId: string
): HistoryLogEntry {
  return {
    address,
    blockHeight,
    timestampIso: new Date().toISOString(),
    eventType: "setRoutingRules",
    amountMicro: null,
    wasEarlyWithdraw: null,
    txId,
  };
}

// ── Pure data helpers (browser-safe) ──────────────────────────────────────────

/** Filter entries for a single address. */
export function filterByAddress(
  entries: HistoryLogEntry[],
  address: string
): HistoryLogEntry[] {
  return entries.filter((e) => e.address === address);
}

/** Sort entries chronologically by blockHeight (ascending). */
export function sortChronological(entries: HistoryLogEntry[]): HistoryLogEntry[] {
  return [...entries].sort((a, b) => a.blockHeight - b.blockHeight);
}
