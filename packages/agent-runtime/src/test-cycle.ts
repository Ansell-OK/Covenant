// packages/agent-runtime/src/test-cycle.ts
//
// Standalone manual test: runs ONE agent cycle with dryRun: true, so nothing
// is actually executed on-chain - this only proves the fetch -> derive
// signals -> judge -> engine chain works end-to-end, before we ever wrap
// this in a polling loop or let it sign real transactions.
//
// Run with: npx ts-node src/test-cycle.ts
//
// Requires .env with STACKS_PRIVATE_KEY and TEST_ADDRESS. Note: dry-run only
// skips the FINAL execute step, not the read calls - fetchVaultContext still
// makes real network calls to testnet even here.

import "dotenv/config";
import { runCycle } from "./cycle";
import type { PolicySpec } from "@covenant/core";

// Reusing the "vesting-strict-after-early-withdraw" example policy verbatim
// from the frontend's EXAMPLE_POLICIES array - already schema-validated and
// used throughout tonight's testing, not a new/unverified policy shape.
const testPolicy: PolicySpec = {
  name: "vesting-strict-after-early-withdraw",
  baseline: { lockPercent: 40, lockDurationBlocks: 2160, splitAddress: null, splitPercent: 0 },
  adjustments: [
    {
      when: "early_withdraw_streak",
      thresholdCount: 2,
      effect: { lockPercentDelta: 30, lockDurationDeltaBlocks: 2160 },
      decay: "reset_on_opposite",
    },
  ],
  bounds: { minLockPercent: 0, maxLockPercent: 90, minLockDurationBlocks: 144, maxLockDurationBlocks: 52560 },
};

async function main() {
  const address = process.env.TEST_ADDRESS;
  const rawKey = process.env.STACKS_PRIVATE_KEY;

  if (!address || !rawKey) {
    console.error(
      "Missing TEST_ADDRESS or STACKS_PRIVATE_KEY in .env - both are required " +
      "even for a dry run, since fetchVaultContext still makes real read calls."
    );
    process.exit(1);
    return; // unreachable, but helps TypeScript narrow types below
  }

  let senderKey: string = rawKey;

  // Leather/Xverse (and most Stacks wallets) work with seed phrases, not raw
  // private keys - STACKS_PRIVATE_KEY may actually be a seed phrase. Same
  // derivation approach already proven working in
  // packages/splitter-contract/scripts/deploy.ts tonight: detect a seed
  // phrase by the presence of spaces, derive the real private key via
  // @stacks/wallet-sdk if so.
  if (senderKey.includes(" ")) {
    const { generateWallet } = require("@stacks/wallet-sdk");
    const wallet = await generateWallet({ secretKey: senderKey, password: "password" });
    const account = wallet.accounts[0];
    senderKey = account.stxPrivateKey;
    console.log("Derived private key from seed phrase.");
  }

  console.log("Running one dry-run agent cycle...");
  console.log("Address:", address);
  console.log("Policy:", testPolicy.name);
  console.log("---");

  const result = await runCycle({
    address,
    policy: testPolicy,
    senderKey,
    depositAmountMicro: "1000000",
    dryRun: true,
  });

  console.log(JSON.stringify(result, null, 2));

  if (result.error) {
    console.error("\nCycle reported an error - see 'error' field above.");
    process.exit(1);
  }

  console.log("\nDry run complete. No transactions were signed or broadcast.");
}

main().catch((err) => {
  console.error("Unhandled error in test-cycle:", err);
  process.exit(1);
});