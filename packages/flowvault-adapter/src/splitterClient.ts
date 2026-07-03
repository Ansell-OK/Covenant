import {
  fetchCallReadOnlyFunction,
  cvToJSON,
  standardPrincipalCV,
} from "@stacks/transactions";
import { STACKS_TESTNET } from "@stacks/network";

const NETWORK = STACKS_TESTNET;

// Default addresses for testnet.
// The splitter holds STX (not a SIP-010 token) and splits on claim().
export const SPLITTER_CONTRACT_ADDRESS = "ST2YJMFAPYZWPFCASY1EJQZMCJZRXGEM9VM5N24WJ.covenant-splitter";

export async function getSplitterBalance(
  splitterContractStr: string,
): Promise<bigint> {
  // Fetch the STX balance of the splitter contract via the Hiro API.
  const res = await fetch(
    `https://api.testnet.hiro.so/extended/v1/address/${splitterContractStr}/balances`
  );
  if (!res.ok) return 0n;
  const balances: any = await res.json();
  return BigInt(balances.stx?.balance ?? "0");
}

export async function getClaimableAmount(
  recipientAddress: string,
  splitterContractStr: string = SPLITTER_CONTRACT_ADDRESS,
): Promise<bigint> {
  const [contractAddress, contractName] = splitterContractStr.split(".");

  try {
    // New contract: get-claimable-amount takes only (who principal).
    // It reads the STX balance internally via stx-get-balance.
    const callRes = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName: "get-claimable-amount",
      functionArgs: [standardPrincipalCV(recipientAddress)],
      network: NETWORK,
      senderAddress: recipientAddress,
    });

    const json = cvToJSON(callRes);
    if (json.type === "(uint)") {
      return BigInt(json.value);
    }
    return 0n;
  } catch (error) {
    console.error("Error reading claimable amount:", error);
    return 0n;
  }
}

export function buildClaimOptions(
  splitterContractStr: string = SPLITTER_CONTRACT_ADDRESS,
) {
  const [contractAddress, contractName] = splitterContractStr.split(".");

  return {
    contractAddress,
    contractName,
    functionName: "claim",
    functionArgs: [], // New contract: claim() takes no arguments
    network: NETWORK,
  };
}
