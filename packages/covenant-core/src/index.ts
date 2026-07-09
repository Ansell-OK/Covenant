// covenant-core/src/index.ts
// Public API surface for @covenant/core

export { PolicySpecSchema } from "./policySpec";
export type { PolicySpec } from "./policySpec";

export type { BehaviorSignals } from "./behaviorSignals";
export { deriveBehaviorSignals } from "./behaviorSignals";

export type { HistoryLogEntry } from "./history";
export {
  makeDepositEntry,
  makeWithdrawEntry,
  makeSetRoutingRulesEntry,
  filterByAddress,
  sortChronological,
} from "./history";
// NOTE: readHistory / appendHistory / writeHistory use Node.js fs — import from
// "@covenant/core/src/history-node" in CLI code only. Never in browser/frontend.

export type { RoutingPlan } from "./routingPlan";

export { engine } from "./engine";



