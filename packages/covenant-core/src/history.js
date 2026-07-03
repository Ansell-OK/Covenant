"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.makeDepositEntry = makeDepositEntry;
exports.makeWithdrawEntry = makeWithdrawEntry;
exports.makeSetRoutingRulesEntry = makeSetRoutingRulesEntry;
exports.filterByAddress = filterByAddress;
exports.sortChronological = sortChronological;
// ── Pure factory helpers (browser-safe) ────────────────────────────────────────
function makeDepositEntry(address, blockHeight, amountMicro, txId) {
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
function makeWithdrawEntry(address, blockHeight, amountMicro, wasEarlyWithdraw, txId) {
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
function makeSetRoutingRulesEntry(address, blockHeight, txId) {
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
function filterByAddress(entries, address) {
    return entries.filter((e) => e.address === address);
}
/** Sort entries chronologically by blockHeight (ascending). */
function sortChronological(entries) {
    return [...entries].sort((a, b) => a.blockHeight - b.blockHeight);
}
//# sourceMappingURL=history.js.map