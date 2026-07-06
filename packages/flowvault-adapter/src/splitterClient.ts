import {
  fetchCallReadOnlyFunction,
  cvToJSON,
  standardPrincipalCV,
  contractPrincipalCV,
  tupleCV, 
  listCV,
  uintCV,
  principalCV
} from "@stacks/transactions";
import { STACKS_TESTNET } from "@stacks/network";

const NETWORK = STACKS_TESTNET;

// Splitter tracks USDCx (SIP-010), not native STX.
export const SPLITTER_CONTRACT_ADDRESS = "ST2YJMFAPYZWPFCASY1EJQZMCJZRXGEM9VM5N24WJ.covenant-splitterv5";
const USDCX_CONTRACT_ADDRESS = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const USDCX_CONTRACT_NAME = "usdcx";

// ── Real read-only calls (safe, free, no transaction needed) ────────────────

// get-recipient-bps is define-read-only in the contract — no contract-call?
// inside it, so this is a genuine free read.
export async function getRecipientBps(
  recipientAddress: string,
  splitterContractStr: string = SPLITTER_CONTRACT_ADDRESS,
): Promise<bigint> {
  const [contractAddress, contractName] = splitterContractStr.split(".");
  try {
    const callRes = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName: "get-recipient-bps",
      functionArgs: [standardPrincipalCV(recipientAddress)],
      network: NETWORK,
      senderAddress: recipientAddress,
    });
    const json = cvToJSON(callRes);
    return BigInt(json.value ?? "0");
  } catch (error) {
    console.error("Error reading recipient bps:", error);
    return 0n;
  }
}

// get-total-ever-claimed is also define-read-only — free read.
export async function getTotalEverClaimed(
  splitterContractStr: string = SPLITTER_CONTRACT_ADDRESS,
): Promise<bigint> {
  const [contractAddress, contractName] = splitterContractStr.split(".");
  try {
    const callRes = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName: "get-total-ever-claimed",
      functionArgs: [],
      network: NETWORK,
      senderAddress: contractAddress,
    });
    const json = cvToJSON(callRes);
    return BigInt(json.value ?? "0");
  } catch (error) {
    console.error("Error reading total ever claimed:", error);
    return 0n;
  }
}

// get-claimed-by is also define-read-only — free read, and it's the piece
// that makes the estimate below exact rather than an overstatement.
export async function getClaimedBy(
  recipientAddress: string,
  splitterContractStr: string = SPLITTER_CONTRACT_ADDRESS,
): Promise<bigint> {
  const [contractAddress, contractName] = splitterContractStr.split(".");
  try {
    const callRes = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName: "get-claimed-by",
      functionArgs: [standardPrincipalCV(recipientAddress)],
      network: NETWORK,
      senderAddress: recipientAddress,
    });
    const json = cvToJSON(callRes);
    return BigInt(json.value ?? "0");
  } catch (error) {
    console.error("Error reading claimed-by amount:", error);
    return 0n;
  }
}

// The splitter's own USDCx balance — a genuine read-only call against the
// USDCx token contract itself (get-balance), not against covenant-splitter.
export async function getSplitterUsdcxBalance(
  splitterContractStr: string = SPLITTER_CONTRACT_ADDRESS,
): Promise<bigint> {
  const [contractAddress] = splitterContractStr.split(".");
  try {
    const callRes = await fetchCallReadOnlyFunction({
      contractAddress: USDCX_CONTRACT_ADDRESS,
      contractName: USDCX_CONTRACT_NAME,
      functionName: "get-balance",
      functionArgs: [standardPrincipalCV(contractAddress)],
      network: NETWORK,
      senderAddress: contractAddress,
    });
    const json = cvToJSON(callRes);
    let val: unknown = json.value;
    let depth = 0;
    while (val && typeof val === "object" && "value" in (val as Record<string, unknown>) && depth < 4) {
      val = (val as Record<string, unknown>).value;
      depth++;
    }
    if (typeof val === "string" || typeof val === "number") {
      return BigInt(val);
    }
    console.warn("getSplitterUsdcxBalance: could not extract a numeric value from response", json);
    return 0n;
  } catch (error) {
    console.error("Error reading splitter USDCx balance:", error);
    return 0n;
  }
}

// ── Claimable amount — computed client-side, NOT an on-chain call ───────────
// get-claimable-amount in the contract is define-public (it calls
// contract-call? internally, which Clarity disallows inside define-read-only).
// A public function generally requires an actual transaction to execute, so
// it can't be queried for free the way a true read-only function can. Since
// this is only needed for display before the user commits to claiming, we
// replicate the exact same formula the contract uses, in TypeScript, using
// only genuine free reads: bps, total-ever-claimed, the splitter's live
// USDCx balance, and — now that get-claimed-by exists — this recipient's own
// already-claimed amount. This is an exact match for what claim() would
// return, not an estimate, as long as no other recipient's claim happens
// between this read and the user's own claim (a small, acceptable race
// given the pull model and low expected claim frequency).
export async function getClaimableAmount(
  recipientAddress: string,
  splitterContractStr: string = SPLITTER_CONTRACT_ADDRESS,
): Promise<bigint> {
  const [bps, totalEverClaimed, currentBalance, alreadyClaimed] = await Promise.all([
    getRecipientBps(recipientAddress, splitterContractStr),
    getTotalEverClaimed(splitterContractStr),
    getSplitterUsdcxBalance(splitterContractStr),
    getClaimedBy(recipientAddress, splitterContractStr),
  ]);
  // TEMPORARY DEBUG LOG - remove once confirmed working
  console.log("getClaimableAmount debug:", {
    recipientAddress,
    bps: bps.toString(),
    totalEverClaimed: totalEverClaimed.toString(),
    currentBalance: currentBalance.toString(),
    alreadyClaimed: alreadyClaimed.toString(),
  });
  if (bps === 0n) return 0n;
  const lifetime = currentBalance + totalEverClaimed;
  const entitled = (lifetime * bps) / 10000n;
  const result = entitled > alreadyClaimed ? entitled - alreadyClaimed : 0n;
  console.log("getClaimableAmount result:", result.toString());
  return result;
}

// ── Claim — a real transaction, must be signed via wallet ────────────────────
export function buildClaimOptions(
  splitterContractStr: string = SPLITTER_CONTRACT_ADDRESS,
) {
  const [contractAddress, contractName] = splitterContractStr.split(".");

  return {
    contractAddress,
    contractName,
    functionName: "claim",
    // claim() requires the USDCx token contract as a trait argument.
    functionArgs: [contractPrincipalCV(USDCX_CONTRACT_ADDRESS, USDCX_CONTRACT_NAME)],
    network: NETWORK,
  };
}

// -- new --
export async function getRecipientCount(
  splitterContractStr: string = SPLITTER_CONTRACT_ADDRESS,
): Promise<number> {
  const [contractAddress, contractName] = splitterContractStr.split(".");
  try {
    const callRes = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName: "get-recipient-count",
      functionArgs: [],
      network: NETWORK,
      senderAddress: contractAddress,
    });
    const json = cvToJSON(callRes);
    return Number(json.value ?? "0");
  } catch (error) {
    console.error("Error reading recipient count:", error);
    return 0;
  }
}
 
// -- new --
// get-recipient-at returns (optional principal) for a given index (0-4).
// Use this + getRecipientCount to enumerate the full active registry for
// display, since the contract has no single "list everyone" function -
// enumeration has to happen client-side by calling this per-index.
export async function getRecipientAt(
  index: number,
  splitterContractStr: string = SPLITTER_CONTRACT_ADDRESS,
): Promise<string | null> {
  const [contractAddress, contractName] = splitterContractStr.split(".");
  try {
    const callRes = await fetchCallReadOnlyFunction({
      contractAddress,
      contractName,
      functionName: "get-recipient-at",
      functionArgs: [uintCV(index)],
      network: NETWORK,
      senderAddress: contractAddress,
    });
    const json = cvToJSON(callRes);
    // (optional principal): unwrap defensively rather than assume one fixed
    // shape - cvToJSON's nesting for optionals has proven inconsistent.
    let val: unknown = json.value;
    if (val && typeof val === "object" && "value" in (val as Record<string, unknown>)) {
      val = (val as Record<string, unknown>).value;
    }
    if (typeof val === "string" && val.length > 0) {
      return val;
    }
    return null;
  } catch (error) {
    console.error(`Error reading recipient at index ${index}:`, error);
    return null;
  }
}
// -- new --
// Fetches the full active registry as an array of {recipient, bps}, by
// reading get-recipient-count then calling get-recipient-at for each index
// and get-recipient-bps for each returned principal. This is several
// sequential reads, not one call - the contract has no batch-read function.
export async function getFullRegistry(
  splitterContractStr: string = SPLITTER_CONTRACT_ADDRESS,
): Promise<Array<{ recipient: string; bps: bigint }>> {
  const count = await getRecipientCount(splitterContractStr);
  const entries: Array<{ recipient: string; bps: bigint }> = [];
  for (let i = 0; i < count; i++) {
    const recipient = await getRecipientAt(i, splitterContractStr);
    if (!recipient) continue;
    const bps = await getRecipientBps(recipient, splitterContractStr);
    entries.push({ recipient, bps });
  }
  return entries;
}
 
// -- new --
// Builds the signable options for a set-registry call. entries must sum to
// exactly 10000 bps and contain between 1 and 5 items - the contract itself
// enforces this and will reject an invalid list, but validate client-side
// too so the wallet doesn't even prompt for an obviously-invalid submission.
export function buildSetRegistryOptions(
  entries: Array<{ recipient: string; bps: number }>,
  splitterContractStr: string = SPLITTER_CONTRACT_ADDRESS,
) {
  if (entries.length === 0 || entries.length > 5) {
    throw new Error("Registry must have between 1 and 5 recipients.");
  }
  const totalBps = entries.reduce((sum, e) => sum + e.bps, 0);
  if (totalBps !== 10000) {
    throw new Error(`Registry shares must sum to exactly 10000 bps (got ${totalBps}).`);
  }
 
  const [contractAddress, contractName] = splitterContractStr.split(".");
 
  const entriesCV = listCV(
    entries.map((e) =>
      tupleCV({
        recipient: principalCV(e.recipient),
        bps: uintCV(e.bps),
      })
    )
  );
 
  return {
    contractAddress,
    contractName,
    functionName: "set-registry",
    functionArgs: [entriesCV, contractPrincipalCV(USDCX_CONTRACT_ADDRESS, USDCX_CONTRACT_NAME)],
    network: NETWORK,
  };
}