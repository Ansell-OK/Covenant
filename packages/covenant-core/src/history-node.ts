// covenant-core/src/history-node.ts
// Node.js-only file I/O helpers for HistoryLogEntry persistence.
//
// ONLY import this in CLI code — never in browser/Next.js code.
// The CLI reads/writes to .covenant/history-<address>.json (local file).
// The frontend uses localStorage (see hooks/useCovenant.ts).

import * as fs from "fs";
import * as path from "path";
import { HistoryLogEntry } from "./history";

const HISTORY_DIR = ".covenant";

function historyFilePath(address: string): string {
  return path.join(HISTORY_DIR, `history-${address}.json`);
}

/** Read all history entries for an address. Returns [] if no file exists. */
export function readHistory(address: string): HistoryLogEntry[] {
  const filePath = historyFilePath(address);
  if (!fs.existsSync(filePath)) return [];
  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    return JSON.parse(raw) as HistoryLogEntry[];
  } catch {
    return [];
  }
}

/** Append a single entry to the local history file. */
export function appendHistory(entry: HistoryLogEntry): void {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
  const filePath = historyFilePath(entry.address);
  const existing = readHistory(entry.address);
  existing.push(entry);
  fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf-8");
}

/** Overwrite the full history array for an address. */
export function writeHistory(address: string, entries: HistoryLogEntry[]): void {
  if (!fs.existsSync(HISTORY_DIR)) {
    fs.mkdirSync(HISTORY_DIR, { recursive: true });
  }
  fs.writeFileSync(
    historyFilePath(address),
    JSON.stringify(entries, null, 2),
    "utf-8"
  );
}
