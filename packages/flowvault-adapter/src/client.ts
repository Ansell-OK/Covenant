// flowvault-adapter/src/client.ts
// SDK initialization — both CLI mode (private key) and browser wallet mode.
//
// This file contains VERBATIM the code from task section 6 (do not re-derive).
// These two functions are the ONLY ways to construct a FlowVault client in Covenant.
//
// Package boundary: this file is the entry point of flowvault-adapter.
// covenant-core NEVER imports from this file.

import { FlowVault } from "flowvault-sdk";

// ── Contract constants (from task §6) ─────────────────────────────────────────
// Do NOT use mainnet addresses — this bounty period runs on testnet only.
const CONTRACT_ADDRESS = "STD7QG84VQQ0C35SZM2EYTHZV4M8FQ0R7YNSQWPD";
const CONTRACT_NAME = "flowvault-v2";
const TOKEN_CONTRACT_ADDRESS = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const TOKEN_CONTRACT_NAME = "usdcx";
const NETWORK = "testnet";

/**
 * Create a backend/CLI FlowVault client using a private key.
 * USE ONLY IN cli/ — NEVER in frontend code.
 *
 * @param senderKey - Private key from STACKS_PRIVATE_KEY env var
 */
export function createCliVault(senderKey: string): FlowVault {
  return new FlowVault({
    network: NETWORK,
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    tokenContractAddress: TOKEN_CONTRACT_ADDRESS,
    tokenContractName: TOKEN_CONTRACT_NAME,
    senderKey,
  });
}

/**
 * Create a browser wallet FlowVault client using @stacks/connect.
 * USE ONLY IN frontend/ — NEVER use private keys in browser code.
 *
 * @param walletAddress - Resolved STX address from wallet connect (ST.../SP... only)
 * @param requestFn - The request function from @stacks/connect (injected to avoid
 *                    importing @stacks/connect directly in adapter; caller provides it)
 */
export function createBrowserVault(
  walletAddress: string,
  requestFn: (method: string, params: Record<string, unknown>) => Promise<unknown>
): FlowVault {
  validateSTXAddress(walletAddress);

  return new FlowVault({
    network: NETWORK,
    contractAddress: CONTRACT_ADDRESS,
    contractName: CONTRACT_NAME,
    tokenContractAddress: TOKEN_CONTRACT_ADDRESS,
    tokenContractName: TOKEN_CONTRACT_NAME,
    senderAddress: walletAddress,
    contractCallExecutor: async (call) =>
      requestFn("stx_callContract", {
        contract: call.contractAddress + "." + call.contractName,
        functionName: call.functionName,
        functionArgs: call.functionArgs,
        network: call.network,
        postConditionMode: "allow",
        postConditions: call.postConditions,
      }),
  });
}

// ── Address validation ────────────────────────────────────────────────────────

/** Valid STX address pattern: ST or SP prefix, 38-40 alphanumeric chars */
const STX_ADDRESS_RE = /^(ST|SP)[A-Z0-9]{38,40}$/;

/**
 * Validate a Stacks address. Throws InvalidAddressError if invalid.
 * Per task §6: reject tb1... (Bitcoin bech32) with a clear error message.
 */
export function validateSTXAddress(address: string): void {
  if (!STX_ADDRESS_RE.test(address)) {
    const isBitcoin =
      address.startsWith("tb1") ||
      address.startsWith("bc1") ||
      address.startsWith("1") ||
      address.startsWith("3");
    if (isBitcoin) {
      throw new InvalidAddressError(
        `"${address}" appears to be a Bitcoin address. ` +
          "FlowVault requires a Stacks address (starting with ST or SP). " +
          "Please connect a Leather or Hiro wallet."
      );
    }
    throw new InvalidAddressError(
      `"${address}" is not a valid Stacks address. ` +
        "Expected format: ST... or SP... (38-40 alphanumeric characters)."
    );
  }
}

// ── Typed error classes (per task §6 requirements) ───────────────────────────

export class InvalidAddressError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAddressError";
  }
}

export class InvalidAmountError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidAmountError";
  }
}

export class InvalidRoutingRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidRoutingRuleError";
  }
}

export class InvalidConfigurationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidConfigurationError";
  }
}

export class ContractCallError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContractCallError";
  }
}

export class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

export class ParsingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ParsingError";
  }
}
