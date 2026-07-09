#!/usr/bin/env node
// covenant CLI — npx covenant run --policy policy.json --address ST...
//
// Persists HistoryLogEntry[] to .covenant/history-<address>.json.
// Reads the history on each run to compute BehaviorSignals.
// Independent of the frontend — proves the package boundary works end-to-end.

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";
import { Command } from "commander";

import {
  PolicySpecSchema,
  engine,
  deriveBehaviorSignals,
} from "@covenant/core";
import {
  readHistory,
  appendHistory,
} from "../../covenant-core/src/history-node";
import { compile } from "@covenant/policy-compiler";
import {
  createCliVault,
  executeDepositCycle,
  executeWithdraw,
  fetchVaultContext,
  InvalidAddressError,
  InvalidAmountError,
  InvalidRoutingRuleError,
  ContractCallError,
  NetworkError,
  ParsingError,
} from "@covenant/flowvault-adapter";

import { getAddressFromPrivateKey } from "@stacks/transactions";
const program = new Command();



async function resolveSenderKey(rawKey: string): Promise<string> {
  // Leather/Xverse (and most Stacks wallets) work with seed phrases, not raw
  // private keys - STACKS_PRIVATE_KEY may be either. Detect a seed phrase by
  // the presence of spaces, derive the real private key via
  // @stacks/wallet-sdk if so. Same approach already proven working in
  // scripts/deploy.ts and agent-runtime/src/test-cycle.ts tonight.
  if (rawKey.includes(" ")) {
    const { generateWallet } = require("@stacks/wallet-sdk");
    const wallet = await generateWallet({ secretKey: rawKey, password: "password" });
    const account = wallet.accounts[0];
    console.log("Derived private key from seed phrase.");
    return account.stxPrivateKey;
  }
  return rawKey;
}



program
  .name("covenant")
  .description(
    "Behavioral vesting engine for FlowVault — adaptive lock/split/hold routing."
  )
  .version("1.0.0");

// ── covenant run ───────────────────────────────────────────────────────────────
program
  .command("run")
  .description(
    "Run one planning + execute cycle for a FlowVault address."
  )
  .requiredOption("--address <address>", "Stacks principal address (ST.../SP...)")
  .option(
    "--policy <path>",
    "Path to a PolicySpec JSON file",
    undefined
  )
  .option(
    "--policy-text <text>",
    "Plain-English policy description (compiled via local-rules or LLM)"
  )
  .option(
    "--deposit <amount>",
    "Deposit amount in micro-units (e.g. 1000000)",
    "1000000"
  )
  .option(
    "--auto-execute",
    "Skip confirmation prompt and execute immediately (opt-in)",
    false
  )
  .option(
    "--dry-run",
    "Compute and display the RoutingPlan without executing any transaction",
    false
  )
  .action(async (opts) => {
    console.log("\nCovenant — Behavioral Vesting Engine\n");
 
    // ── Load private key ─────────────────────────────────────────────────
    const rawSenderKey = process.env.STACKS_PRIVATE_KEY;
    if (!rawSenderKey && !opts.dryRun) {
      console.error(
        "STACKS_PRIVATE_KEY is not set. " +
          "Add it to your .env file (CLI mode only - never in frontend)."
      );
      process.exit(1);
    }
    const senderKey = rawSenderKey ? await resolveSenderKey(rawSenderKey) : rawSenderKey;

    if (!opts.dryRun) {
      if (!senderKey) {
        console.error("STACKS_PRIVATE_KEY resolution failed unexpectedly.");
        process.exit(1);
        return;
      }

      const derivedAddress = getAddressFromPrivateKey(senderKey, "testnet");
      if (derivedAddress !== opts.address) {
        console.error(
          "\nADDRESS MISMATCH:\n" +
          "  --address flag says:              " + opts.address + "\n" +
          "  Your private key/seed derives to: " + derivedAddress + "\n\n" +
          "The transaction would be signed by " + derivedAddress + ", NOT " + opts.address + ".\n" +
          "This is almost certainly not what you want - either:\n" +
          "  1. Change --address to match " + derivedAddress + ", or\n" +
          "  2. Set STACKS_PRIVATE_KEY to a key/seed that actually derives to " + opts.address + "\n"
        );
        process.exit(1);
      }
    }
 
    // ── Load / compile policy ────────────────────────────────────────────
    let policy;
    if (opts.policy) {
      const raw = fs.readFileSync(path.resolve(opts.policy), "utf-8");
      const parsed = PolicySpecSchema.safeParse(JSON.parse(raw));
      if (!parsed.success) {
        console.error("❌ Invalid PolicySpec:", parsed.error.format());
        process.exit(1);
      }
      policy = parsed.data;
      console.log(`📋 Policy loaded: ${policy.name}`);
    } else if (opts.policyText) {
      console.log("🧠 Compiling policy from English text...");
      const result = await compile(opts.policyText, "cli-policy");
      policy = result.policy;
      console.log(
        `📋 Policy compiled via ${result.provider}${result.usedFallback ? " (fallback)" : ""}: ${policy.name}`
      );
      if (result.fallbackReason) {
        console.warn(`⚠️  ${result.fallbackReason}`);
      }
      if (result.warnings.length > 0) {
        result.warnings.forEach((w) => console.warn(`⚠️  ${w.message}`));
      }
    } else {
      console.error(
        "❌ Provide either --policy <path> or --policy-text <text>"
      );
      process.exit(1);
    }

    // ── Initialize vault client ──────────────────────────────────────────
    const vault = opts.dryRun ? null : createCliVault(senderKey!);

    // ── Fetch current block + vault state ────────────────────────────────
    let currentBlock: number;
    if (opts.dryRun) {
      // Use a synthetic block number for dry runs
      currentBlock = Math.floor(Date.now() / 600_000); // rough approximation
      console.log(`🔎 Dry run mode — synthetic block: ${currentBlock}`);
    } else {
      try {
        const ctx = await fetchVaultContext(vault!, opts.address);
        currentBlock = ctx.currentBlock;
        console.log(`📦 Current block: ${currentBlock}`);
        console.log(
          `💰 Vault state: unlocked=${(ctx.vaultState as any)?.unlockedBalance ?? "?"}, locked=${(ctx.vaultState as any)?.lockedBalance ?? "?"}`
        );
      } catch (err) {
        console.error("❌ Failed to fetch vault state:", formatError(err));
        process.exit(1);
      }
    }

    // ── Load history + derive signals ────────────────────────────────────
    const history = readHistory(opts.address);
    const signals = deriveBehaviorSignals(history, currentBlock, policy);

    console.log("\n📊 Behavior Signals:");
    console.log(
      `   consecutiveEarlyWithdraws: ${signals.consecutiveEarlyWithdraws}`
    );
    console.log(
      `   consecutiveHonoredLocks:   ${signals.consecutiveHonoredLocks}`
    );
    console.log(
      `   blocksSinceLastDeposit:    ${signals.blocksSinceLastDeposit ?? "n/a (no prior deposit)"}`
    );
    console.log(
      `   outflow (last ${signals.outflowLastWindow.windowBlocks} blocks): ${signals.outflowLastWindow.withdrawCount} withdrawals`
    );

    // ── Compute routing plan ─────────────────────────────────────────────
    const depositAmount = opts.deposit;
    const plan = engine(signals, policy, depositAmount, currentBlock);

    console.log("\n🗺️  Routing Plan:");
    console.log(
      `   lockAmount:     ${plan.lockAmountMicro} micro-units (${toPercent(plan.lockAmountMicro, depositAmount)}%)`
    );
    console.log(
      `   splitAmount:    ${plan.splitAmountMicro} micro-units (${toPercent(plan.splitAmountMicro, depositAmount)}%)`
    );
    console.log(`   lockUntilBlock: ${plan.lockUntilBlock}`);
    console.log(`   splitAddress:   ${plan.splitAddress ?? "none"}`);
    console.log(`   rationale:      ${plan.rationale}`);
    console.log(
      `   adjustments:    ${plan.appliedAdjustmentIds.length > 0 ? plan.appliedAdjustmentIds.join(", ") : "none (baseline)"}`
    );

    if (opts.dryRun) {
      console.log("\n✅ Dry run complete — no transaction sent.");
      return;
    }

    // ── Confirm or auto-execute ──────────────────────────────────────────
    if (!opts.autoExecute) {
      const confirmed = await confirm(
        "\n❓ Execute this plan? (setRoutingRules + deposit) [y/N]: "
      );
      if (!confirmed) {
        console.log("Aborted.");
        return;
      }
    } else {
      console.log(
        "\n⚡ Auto-execute enabled — signing immediately (opt-in flag set)"
      );
    }

    // ── Execute ──────────────────────────────────────────────────────────
    console.log("\n🚀 Executing...");
    try {
      const result = await executeDepositCycle(
        vault!,
        opts.address,
        plan,
        depositAmount,
        currentBlock
      );

      console.log(`\n✅ setRoutingRules tx: ${result.setRulesTxId}`);
      console.log(`✅ deposit tx:         ${result.depositTxId}`);
      console.log(
        `🔗 Explorer: https://explorer.hiro.so/txid/${result.depositTxId}?chain=testnet`
      );

      // Persist history
      result.historyEntries.forEach((e) => appendHistory(e));
      console.log(
        `📝 History updated → .covenant/history-${opts.address}.json`
      );
    } catch (err) {
      console.error("❌ Execution failed:", formatError(err));
      process.exit(1);
    }
  });

// ── covenant withdraw ──────────────────────────────────────────────────────────
program
  .command("withdraw")
  .description("Withdraw from the vault and record the event in history.")
  .requiredOption("--address <address>", "Stacks principal address")
  .option("--amount <amount>", "Amount in micro-units", "1000000")
  .action(async (opts) => {
    const rawSenderKey = process.env.STACKS_PRIVATE_KEY;
    if (!rawSenderKey) {
      console.error("STACKS_PRIVATE_KEY is not set.");
      process.exit(1);
      return;
    }
    const senderKey = await resolveSenderKey(rawSenderKey);

    const derivedAddress = getAddressFromPrivateKey(senderKey, "testnet");
    if (derivedAddress !== opts.address) {
      console.error(
        "\nADDRESS MISMATCH:\n" +
        "  --address flag says:              " + opts.address + "\n" +
        "  Your private key/seed derives to: " + derivedAddress + "\n\n" +
        "The transaction would be signed by " + derivedAddress + ", NOT " + opts.address + ".\n"
      );
      process.exit(1);
      return;
    }

    const vault = createCliVault(senderKey);

    let currentBlock: number;
    try {
      const ctx = await fetchVaultContext(vault, opts.address);
      currentBlock = ctx.currentBlock;
    } catch (err) {
      console.error("❌ Failed to fetch vault context:", formatError(err));
      process.exit(1);
    }

    console.log(`\n💸 Withdrawing ${opts.amount} micro-units from ${opts.address}...`);

    try {
      const { txId, historyEntry } = await executeWithdraw(
        vault,
        opts.address,
        opts.amount,
        currentBlock
      );

      appendHistory(historyEntry);

      console.log(`✅ Withdraw tx: ${txId}`);
      console.log(
        `   wasEarlyWithdraw: ${historyEntry.wasEarlyWithdraw}`
      );
      console.log(
        `🔗 Explorer: https://explorer.hiro.so/txid/${txId}?chain=testnet`
      );
    } catch (err) {
      console.error("❌ Withdraw failed:", formatError(err));
      process.exit(1);
    }
  });

// ── covenant history ───────────────────────────────────────────────────────────
program
  .command("history")
  .description("Display the stored history log for an address.")
  .requiredOption("--address <address>", "Stacks principal address")
  .action((opts) => {
    const entries = readHistory(opts.address);
    if (entries.length === 0) {
      console.log(
        `No history found for ${opts.address}. ` +
          "(Run 'covenant run' first, or delete .covenant/ to reset.)"
      );
      return;
    }
    console.log(`\nHistory for ${opts.address} (${entries.length} entries):\n`);
    entries.forEach((e, i) => {
      console.log(
        `  ${i + 1}. block ${e.blockHeight} | ${e.eventType.padEnd(15)} | ` +
          `amount: ${e.amountMicro ?? "n/a"} | ` +
          `earlyWithdraw: ${e.wasEarlyWithdraw ?? "n/a"} | ` +
          `tx: ${e.txId.slice(0, 12)}...`
      );
    });
  });

// ── covenant claim ─────────────────────────────────────────────────────────────
program
  .command("claim")
  .description("Claim available funds from the splitter contract for an address.")
  .requiredOption("--address <address>", "Stacks principal address")
  .action(async (opts) => {
    const senderKey = process.env.STACKS_PRIVATE_KEY;
    if (!senderKey) {
      console.error("❌ STACKS_PRIVATE_KEY is not set.");
      process.exit(1);
    }

    console.log(`\n💸 Checking claimable amount for ${opts.address}...`);
    try {
      const { getClaimableAmount, buildClaimOptions } = await import("@covenant/flowvault-adapter");
      const { makeContractCall, broadcastTransaction } = await import("@stacks/transactions");

      const amount = await getClaimableAmount(opts.address);
      if (amount === 0n) {
        console.log(`No funds to claim for ${opts.address}.`);
        return;
      }
      console.log(`💰 Found ${amount.toString()} micro-USDCx claimable.`);
      
      const confirmRun = await confirm("Proceed with claim? (y/N) ");
      if (!confirmRun) {
        console.log("Aborted.");
        return;
      }

      const claimOptions = buildClaimOptions();
      const transaction = await makeContractCall({
        contractAddress: claimOptions.contractAddress,
        contractName: claimOptions.contractName,
        functionName: claimOptions.functionName,
        functionArgs: claimOptions.functionArgs,
        network: claimOptions.network,
        senderKey: senderKey,
      });

      const broadcastResponse = await broadcastTransaction({ transaction });

      if ("error" in broadcastResponse && broadcastResponse.error) {
        throw new Error((broadcastResponse as any).reason || broadcastResponse.error);
      }
      
      const txid = typeof broadcastResponse === "string" ? broadcastResponse : (broadcastResponse as any).txid;
      console.log(`✅ Claim tx: ${txid}`);
      console.log(`🔗 Explorer: https://explorer.hiro.so/txid/${txid}?chain=testnet`);
    } catch (err) {
      console.error("❌ Claim failed:", formatError(err));
      process.exit(1);
    }
  });

program.parse(process.argv);

// ── Utilities ─────────────────────────────────────────────────────────────────

function toPercent(amountMicro: string, depositMicro: string): string {
  const pct =
    (Number(BigInt(amountMicro)) / Number(BigInt(depositMicro))) * 100;
  return pct.toFixed(1);
}

function formatError(err: unknown): string {
  if (
    err instanceof InvalidAddressError ||
    err instanceof InvalidAmountError ||
    err instanceof InvalidRoutingRuleError ||
    err instanceof ContractCallError ||
    err instanceof NetworkError ||
    err instanceof ParsingError
  ) {
    return `[${err.name}] ${err.message}`;
  }
  if (err instanceof Error) return err.message;
  return String(err);
}

function confirm(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}
