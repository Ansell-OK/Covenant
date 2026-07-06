import { makeContractDeploy, AnchorMode, PostConditionMode, serializeTransactionBytes } from "@stacks/transactions";
import { STACKS_TESTNET, STACKS_MAINNET, STACKS_MOCKNET } from "@stacks/network";
import * as fs from "fs";
import * as path from "path";
import * as dotenv from "dotenv";

dotenv.config({ path: path.join(__dirname, "../../../.env.local") });

async function run() {
  let deployerKey = process.env.DEPLOYER_KEY;
  if (!deployerKey) {
    throw new Error("DEPLOYER_KEY is not set in environment");
  }

  // If it's a seed phrase, derive the private key
  if (deployerKey.includes(" ")) {
    const { generateWallet } = require("@stacks/wallet-sdk");
    const wallet = await generateWallet({ secretKey: deployerKey, password: "password" });
    const account = wallet.accounts[0];
    deployerKey = account.stxPrivateKey;
    console.log("Derived private key from seed phrase.");
  }

  const networkString = process.env.STX_NETWORK || "testnet";
  let network: typeof STACKS_TESTNET;
  if (networkString === "mainnet") {
    network = STACKS_MAINNET;
  } else if (networkString === "mocknet") {
    network = STACKS_MOCKNET;
  } else {
    network = STACKS_TESTNET;
  }

  const contractName = "covenant-splitterv5"; // Change this to your desired contract name
  // Strip any non-ASCII characters to avoid codec errors
  const rawCode = fs.readFileSync(path.join(__dirname, "../contracts/covenant-splitter.clar"), "utf8");
  const codeBody = rawCode.replace(/[^\x00-\x7F]/g, "~");

  console.log(`Deploying ${contractName} to ${networkString}...`);

  const txOptions = {
    contractName,
    codeBody,
    senderKey: deployerKey as string,
    network,
    anchorMode: AnchorMode.Any,
    postConditionMode: PostConditionMode.Allow,
    clarityVersion: 3,
    fee: BigInt(500000),
  };

  const transaction = await makeContractDeploy(txOptions);

  // Manually broadcast using raw fetch to avoid SDK JSON parse issues
  // Stacks API expects hex-encoded transaction in a JSON body
  const serialized = serializeTransactionBytes(transaction);
  const serializedBuf = Buffer.from(serialized);
  const hex = serializedBuf.toString("hex");

  const broadcastUrl = "https://api.testnet.hiro.so/v2/transactions";
  const response = await fetch(broadcastUrl, {
    method: "POST",
    headers: { "Content-Type": "application/octet-stream" },
    body: serializedBuf,
  });

  const responseText = await response.text();
  console.log("Broadcast response status:", response.status);
  console.log("Broadcast response:", responseText);

  if (response.ok || response.status === 200) {
    let txId: string;
    try {
      const json = JSON.parse(responseText);
      txId = json.txid || json.tx_id || json;
    } catch {
      txId = responseText.replace(/"/g, "").trim();
    }
    console.log(`\nDeployment broadcasted!`);
    console.log(`TxId: ${txId}`);
    console.log(`Explorer: https://explorer.hiro.so/txid/${txId}?chain=testnet`);
    console.log(`Contract will be deployed as .covenant-splitter at your address.`);
  } else {
    throw new Error(`Broadcast failed with status ${response.status}: ${responseText}`);
  }
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
