// frontend/lib/flowvault.ts
// Browser-mode FlowVault client initialization.
// Uses @stacks/connect for wallet signing — NO private keys in browser code.

import { FlowVault } from "flowvault-sdk";
import { request } from "@stacks/connect";

const FLOWVAULT_CONFIG = {
  network: (process.env.NEXT_PUBLIC_FLOWVAULT_NETWORK ?? "testnet") as "testnet" | "mainnet",
  contractAddress:
    process.env.NEXT_PUBLIC_FLOWVAULT_CONTRACT_ADDRESS ??
    "STD7QG84VQQ0C35SZM2EYTHZV4M8FQ0R7YNSQWPD",
  contractName:
    process.env.NEXT_PUBLIC_FLOWVAULT_CONTRACT_NAME ?? "flowvault-v2",
  tokenContractAddress:
    process.env.NEXT_PUBLIC_FLOWVAULT_TOKEN_CONTRACT_ADDRESS ??
    "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM",
  tokenContractName:
    process.env.NEXT_PUBLIC_FLOWVAULT_TOKEN_CONTRACT_NAME ?? "usdcx",
};

/**
 * Create a browser-mode FlowVault vault instance for a connected wallet.
 * Safe to call in React components — uses wallet signing, no private key.
 *
 * @param walletAddress - The connected STX address (ST.../SP...)
 */
export function createBrowserVaultClient(walletAddress: string): FlowVault {
  return new FlowVault({
    ...FLOWVAULT_CONFIG,
    senderAddress: walletAddress,
    contractCallExecutor: async (call) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (request as any)("stx_callContract", {
        contract: call.contractAddress + "." + call.contractName,
        functionName: call.functionName,
        functionArgs: call.functionArgs,
        network: call.network,
        postConditionMode: "allow",
        postConditions: call.postConditions,
      }),
  });
}

export { FLOWVAULT_CONFIG };
