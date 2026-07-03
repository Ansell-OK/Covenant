import { describe, it, expect, beforeEach } from "vitest";
import { initSimnet } from "@stacks/clarinet-sdk";
import { Cl } from "@stacks/transactions";

let simnet: Awaited<ReturnType<typeof initSimnet>>;

beforeEach(async () => {
  simnet = await initSimnet();
});

const RECIPIENT_1 = "ST1SJ3DTE5DN7X54YDH5D64R3BCB6A2AG2ZQ8YPD5";
const RECIPIENT_2 = "ST2YJMFAPYZWPFCASY1EJQZMCJZRXGEM9VM5N24WJ";
const RECIPIENT_3 = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";

describe("covenant-splitter", () => {
  it("1. Deploy with 3 recipients at 5000/3000/2000 bps; confirm get-recipient-bps returns correct values", () => {
    const r1 = simnet.callReadOnlyFn("covenant-splitter", "get-recipient-bps", [Cl.principal(RECIPIENT_1)], RECIPIENT_1);
    expect(r1.result).toEqual(Cl.uint(5000));

    const r2 = simnet.callReadOnlyFn("covenant-splitter", "get-recipient-bps", [Cl.principal(RECIPIENT_2)], RECIPIENT_1);
    expect(r2.result).toEqual(Cl.uint(3000));

    const r3 = simnet.callReadOnlyFn("covenant-splitter", "get-recipient-bps", [Cl.principal(RECIPIENT_3)], RECIPIENT_1);
    expect(r3.result).toEqual(Cl.uint(2000));

    const NON_RECIPIENT = simnet.getAccounts().get("wallet_1")!;
    const rNon = simnet.callReadOnlyFn("covenant-splitter", "get-recipient-bps", [Cl.principal(NON_RECIPIENT)], RECIPIENT_1);
    expect(rNon.result).toEqual(Cl.uint(0));
  });

  it("2. Simulate an STX deposit, then confirm get-claimable-amount returns correct split", () => {
    const deployer = simnet.getAccounts().get("deployer")!;
    const splitterContract = `${deployer}.covenant-splitter`;

    // Transfer 1000 uSTX to the splitter contract
    simnet.transferSTX(1000n, splitterContract, deployer);

    // R1 = 5000 bps (50%) of 1000 = 500
    const claim1 = simnet.callReadOnlyFn("covenant-splitter", "get-claimable-amount", [Cl.principal(RECIPIENT_1)], RECIPIENT_1);
    expect(claim1.result).toEqual(Cl.uint(500));

    // R2 = 3000 bps (30%) of 1000 = 300
    const claim2 = simnet.callReadOnlyFn("covenant-splitter", "get-claimable-amount", [Cl.principal(RECIPIENT_2)], RECIPIENT_1);
    expect(claim2.result).toEqual(Cl.uint(300));

    // R3 = 2000 bps (20%) of 1000 = 200
    const claim3 = simnet.callReadOnlyFn("covenant-splitter", "get-claimable-amount", [Cl.principal(RECIPIENT_3)], RECIPIENT_1);
    expect(claim3.result).toEqual(Cl.uint(200));
  });

  it("3. Recipient 1 claims full amount, balance changes, total-ever-claimed increases", () => {
    const deployer = simnet.getAccounts().get("deployer")!;
    const splitterContract = `${deployer}.covenant-splitter`;

    // Deposit 1000 uSTX into splitter
    simnet.transferSTX(1000n, splitterContract, deployer);

    // Recipient 1 claims their 50% = 500
    const res = simnet.callPublicFn("covenant-splitter", "claim", [], RECIPIENT_1);
    expect(res.result).toEqual(Cl.ok(Cl.uint(500)));

    // total-ever-claimed should now be 500
    const total = simnet.callReadOnlyFn("covenant-splitter", "get-total-ever-claimed", [], deployer);
    expect(total.result).toEqual(Cl.uint(500));

    // Recipient 1 should now have 0 claimable (500 paid, 50% of 500 remaining = 0 extra)
    const claim1Again = simnet.callReadOnlyFn("covenant-splitter", "get-claimable-amount", [Cl.principal(RECIPIENT_1)], RECIPIENT_1);
    expect(claim1Again.result).toEqual(Cl.uint(0));
  });

  it("4. Second deposit arrives after first claim; no double-counting", () => {
    const deployer = simnet.getAccounts().get("deployer")!;
    const splitterContract = `${deployer}.covenant-splitter`;

    // First deposit: 1000 uSTX
    simnet.transferSTX(1000n, splitterContract, deployer);

    // Recipient 1 claims 500
    simnet.callPublicFn("covenant-splitter", "claim", [], RECIPIENT_1);

    // Second deposit: another 1000 uSTX
    simnet.transferSTX(1000n, splitterContract, deployer);

    // Lifetime = 2000, R1 entitled to 50% = 1000, already claimed 500, so claimable = 500
    const claim1 = simnet.callReadOnlyFn("covenant-splitter", "get-claimable-amount", [Cl.principal(RECIPIENT_1)], RECIPIENT_1);
    expect(claim1.result).toEqual(Cl.uint(500));
  });

  it("5. Non-recipient calls claim -> ERR_NOT_A_RECIPIENT (u100)", () => {
    const deployer = simnet.getAccounts().get("deployer")!;
    const NON_RECIPIENT = simnet.getAccounts().get("wallet_1")!;

    const claimRes = simnet.callPublicFn("covenant-splitter", "claim", [], NON_RECIPIENT);
    expect(claimRes.result).toEqual(Cl.error(Cl.uint(100)));
  });

  it("6. Recipient with zero claimable calls claim -> ERR_ZERO_CLAIMABLE (u101)", () => {
    // No deposits, so claimable is 0
    const claimRes = simnet.callPublicFn("covenant-splitter", "claim", [], RECIPIENT_1);
    expect(claimRes.result).toEqual(Cl.error(Cl.uint(101)));
  });

  it("7. receive() is a callable no-op that returns (ok true)", () => {
    const deployer = simnet.getAccounts().get("deployer")!;
    const res = simnet.callPublicFn("covenant-splitter", "receive", [], deployer);
    expect(res.result).toEqual(Cl.ok(Cl.bool(true)));
  });

  it("8. Deploy-time validation: TOTAL_BPS must equal u10000", () => {
    // If deployment succeeded (simnet loads it), the assert passed
    const deployer = simnet.getAccounts().get("deployer")!;
    const r = simnet.callReadOnlyFn("covenant-splitter", "get-total-ever-claimed", [], deployer);
    expect(r.result).toEqual(Cl.uint(0));
  });
});
