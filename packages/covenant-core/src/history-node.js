"use strict";
// covenant-core/src/history-node.ts
// Node.js-only file I/O helpers for HistoryLogEntry persistence.
//
// ONLY import this in CLI code — never in browser/Next.js code.
// The CLI reads/writes to .covenant/history-<address>.json (local file).
// The frontend uses localStorage (see hooks/useCovenant.ts).
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.readHistory = readHistory;
exports.appendHistory = appendHistory;
exports.writeHistory = writeHistory;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const HISTORY_DIR = ".covenant";
function historyFilePath(address) {
    return path.join(HISTORY_DIR, `history-${address}.json`);
}
/** Read all history entries for an address. Returns [] if no file exists. */
function readHistory(address) {
    const filePath = historyFilePath(address);
    if (!fs.existsSync(filePath))
        return [];
    try {
        const raw = fs.readFileSync(filePath, "utf-8");
        return JSON.parse(raw);
    }
    catch {
        return [];
    }
}
/** Append a single entry to the local history file. */
function appendHistory(entry) {
    if (!fs.existsSync(HISTORY_DIR)) {
        fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    const filePath = historyFilePath(entry.address);
    const existing = readHistory(entry.address);
    existing.push(entry);
    fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), "utf-8");
}
/** Overwrite the full history array for an address. */
function writeHistory(address, entries) {
    if (!fs.existsSync(HISTORY_DIR)) {
        fs.mkdirSync(HISTORY_DIR, { recursive: true });
    }
    fs.writeFileSync(historyFilePath(address), JSON.stringify(entries, null, 2), "utf-8");
}
//# sourceMappingURL=history-node.js.map