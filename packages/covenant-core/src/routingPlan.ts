// covenant-core/src/routingPlan.ts
// RoutingPlan — the engine's output, and the ONLY thing flowvault-adapter
// needs from covenant-core to make its SDK calls.
//
// Package boundary: covenant-core has NO import of flowvault-sdk anywhere.
// The adapter's executor.ts receives a RoutingPlan and maps it 1:1 to
// the SDK's setRoutingRules({ lockAmount, lockUntilBlock, splitAddress, splitAmount }) call:
//   lockAmountMicro  -> lockAmount
//   splitAmountMicro -> splitAmount
//   lockUntilBlock   -> lockUntilBlock
//   splitAddress     -> splitAddress
// No further transformation is required.
//
// The engine guarantees:
//   BigInt(lockAmountMicro) + BigInt(splitAmountMicro) <= depositAmountMicro
// This is the client-side guard for the contract's deterministic-abort behavior.

export type RoutingPlan = {
  splitAddress: string | null;
  splitAmountMicro: string;         // bigint as string, computed from splitPercent * depositAmount
  lockAmountMicro: string;          // bigint as string, computed from lockPercent * depositAmount
  lockUntilBlock: number;           // absolute block height = currentBlock + lockDurationBlocks
  rationale: string;                // <= 2 sentences, human-readable, shown in the UI's explain panel
  appliedAdjustmentIds: string[];   // which `when` values fired this cycle, for the audit log
};
