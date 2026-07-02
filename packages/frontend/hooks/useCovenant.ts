"use client";
// frontend/hooks/useCovenant.ts
// Main React hook: wallet connect, state polling, engine, history management.
// Thin consumer of covenant-core, flowvault-adapter, and policy-compiler.
// No routing/vesting logic here — that belongs in covenant-core.

import { useState, useCallback, useEffect, useRef } from "react";
import { connect } from "@stacks/connect";
import type {
  PolicySpec,
  BehaviorSignals,
  RoutingPlan,
  HistoryLogEntry,
} from "@covenant/core";
import { engine, deriveBehaviorSignals, PolicySpecSchema } from "@covenant/core";
import { compile, type CompileResult } from "@covenant/policy-compiler";
import { createBrowserVaultClient } from "../lib/flowvault";

// ── Token config ────────────────────────────────────────────────────────────────
const USDCX_CONTRACT_ADDRESS = "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM";
const USDCX_CONTRACT_NAME = "usdcx";
const HIRO_API = "https://api.testnet.hiro.so";

// ── USDCx balance via SIP-010 get-balance read-only call ────────────────────────
// Uses /v2/contracts/call-read — no address validation issues, no API key needed.
// Serializes the principal as a Clarity hex value manually (1-byte prefix 0x05 + 20-byte hash).
// We use the simple approach: Hiro's read-only endpoint also accepts a named "principal" argument
// passed as a hex-serialized Clarity standard principal.
async function fetchUsdcxBalance(walletAddress: string): Promise<string> {
  try {
    // Encode the address as a Clarity standard principal CV.
    // Hiro's API accepts the argument as a hex string of the serialized Clarity value.
    // We use the REST read-only endpoint with a string-encoded argument.
    // The simplest cross-version approach: call the Stacks read-only endpoint with
    // the address serialized via Buffer. @stacks/transactions is in root node_modules.
    const { standardPrincipalCV, cvToHex, deserializeCV } = await import("@stacks/transactions");
    const principalCV = standardPrincipalCV(walletAddress);
    const argHex = cvToHex(principalCV);

    const res = await fetch(
      `${HIRO_API}/v2/contracts/call-read/${USDCX_CONTRACT_ADDRESS}/${USDCX_CONTRACT_NAME}/get-balance`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sender: walletAddress,
          arguments: [argHex],
        }),
      }
    );

    if (!res.ok) return "0";
    const data = await res.json() as { okay: boolean; result?: string };
    if (!data.okay || !data.result) return "0";

    // Result is a hex-encoded Clarity value: (ok uint <balance>)
    // We parse it: the response hex decodes to a Clarity response-ok wrapping a uint.
    const cv = deserializeCV(data.result);
    // cv is { type: ResponseOkID, value: { type: UIntID, value: BigInt } }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const inner = (cv as any)?.value?.value;
    if (inner !== undefined) return String(inner);
    return "0";
  } catch (e) {
    console.warn("fetchUsdcxBalance failed:", e);
    return "0";
  }
}

// ── In-memory history store ────────────────────────────────────────────────────
const STORAGE_KEY_PREFIX = "covenant_history_";

function loadHistory(address: string): HistoryLogEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_PREFIX + address);
    return raw ? (JSON.parse(raw) as HistoryLogEntry[]) : [];
  } catch {
    return [];
  }
}

function saveHistory(address: string, entries: HistoryLogEntry[]): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY_PREFIX + address, JSON.stringify(entries));
}

// ── Transaction record (for the UI audit trail) ────────────────────────────────
export interface TxRecord {
  txId: string;
  type: "deposit" | "withdraw" | "setRoutingRules";
  blockHeight: number;
  timestamp: string;
  explorerUrl: string;
}

// ── Hook state ─────────────────────────────────────────────────────────────────
export interface CovenantState {
  // Wallet
  walletAddress: string | null;
  isConnecting: boolean;
  connectError: string | null;

  // Policy
  policyText: string;
  compileResult: CompileResult | null;
  isCompiling: boolean;
  compileError: string | null;
  selectedPolicy: PolicySpec | null;
  // Beneficiary override for split address (e.g. payroll use case)
  splitAddressOverride: string;

  // Chain context
  currentBlock: number | null;
  vaultState: { unlocked: string; locked: string; lockUntilBlock: number } | null;
  usdcxBalance: string | null;       // wallet's USDCx balance (micro-units)
  isFetchingContext: boolean;

  // Signals
  behaviorSignals: BehaviorSignals | null;

  // Plan
  routingPlan: RoutingPlan | null;
  isPlanComputed: boolean;

  // Execution
  isExecuting: boolean;
  executeError: string | null;
  autoExecute: boolean;
  lastTxs: TxRecord[];

  // Deposit
  depositAmountMicro: string;

  // Withdraw
  isWithdrawing: boolean;
  withdrawError: string | null;
  withdrawAmountMicro: string;

  // History
  history: HistoryLogEntry[];
}

export interface CovenantActions {
  connectWallet: () => Promise<void>;
  disconnectWallet: () => void;
  setPolicyText: (text: string) => void;
  compilePolicy: () => Promise<void>;
  loadExamplePolicy: (policy: PolicySpec, name: string) => void;
  fetchContext: () => Promise<void>;
  previewPlan: () => void;
  executePlan: () => Promise<void>;
  withdrawFromVault: () => Promise<void>;
  setAutoExecute: (v: boolean) => void;
  setDepositAmount: (v: string) => void;
  setWithdrawAmount: (v: string) => void;
  setSplitAddressOverride: (v: string) => void;
  clearHistory: () => void;
}

const EXPLORER_BASE = "https://explorer.hiro.so/txid/";

export function useCovenant(): CovenantState & CovenantActions {
  const [state, setState] = useState<CovenantState>({
    walletAddress: null,
    isConnecting: false,
    connectError: null,
    policyText: "",
    compileResult: null,
    isCompiling: false,
    compileError: null,
    selectedPolicy: null,
    splitAddressOverride: "",
    currentBlock: null,
    vaultState: null,
    usdcxBalance: null,
    isFetchingContext: false,
    behaviorSignals: null,
    routingPlan: null,
    isPlanComputed: false,
    isExecuting: false,
    executeError: null,
    autoExecute: false,
    lastTxs: [],
    depositAmountMicro: "1000000",
    isWithdrawing: false,
    withdrawError: null,
    withdrawAmountMicro: "1000000",
    history: [],
  });

  const vaultRef = useRef<ReturnType<typeof createBrowserVaultClient> | null>(null);

  // ── Wallet Connect ─────────────────────────────────────────────────────────
  const connectWallet = useCallback(async () => {
    setState((s) => ({ ...s, isConnecting: true, connectError: null }));
    try {
      // @stacks/connect v8: connect() opens the wallet picker and calls getAddresses.
      // Response shape: { addresses: Array<{ address, publicKey, symbol? }> } — no result wrapper.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const response = await connect() as any;

      const addresses: Array<{ address: string; publicKey: string; symbol?: string }> =
        response?.addresses ?? [];

      // Primary: filter by symbol='STX'; Fallback: address prefix ST/SP
      const stxAddr =
        addresses.find((a) => a.symbol === "STX")?.address ??
        addresses.find((a) => a.address.startsWith("ST") || a.address.startsWith("SP"))?.address;

      if (!stxAddr) {
        console.error("getAddresses raw response:", JSON.stringify(response, null, 2));
        throw new Error(
          `No Stacks address found. Wallet returned ${addresses.length} address(es): ` +
          addresses.map((a) => `${a.symbol ?? "?"}: ${a.address.slice(0, 10)}...`).join(", ") +
          ". Make sure your Leather/Hiro wallet is unlocked and set to Testnet."
        );
      }

      vaultRef.current = createBrowserVaultClient(stxAddr);
      const history = loadHistory(stxAddr);

      setState((s) => ({
        ...s,
        walletAddress: stxAddr,
        isConnecting: false,
        history,
      }));
    } catch (err: unknown) {
      setState((s) => ({
        ...s,
        isConnecting: false,
        connectError:
          err instanceof Error ? err.message : "Wallet connection failed.",
      }));
    }
  }, []);

  const disconnectWallet = useCallback(() => {
    vaultRef.current = null;
    setState((s) => ({
      ...s,
      walletAddress: null,
      currentBlock: null,
      vaultState: null,
      usdcxBalance: null,
      behaviorSignals: null,
      routingPlan: null,
      isPlanComputed: false,
      history: [],
    }));
  }, []);

  // ── Policy ─────────────────────────────────────────────────────────────────
  const setPolicyText = useCallback((text: string) => {
    setState((s) => ({ ...s, policyText: text }));
  }, []);

  const compilePolicy = useCallback(async () => {
    setState((s) => ({ ...s, isCompiling: true, compileError: null }));
    try {
      const result = await compile(state.policyText, "frontend-policy");
      setState((s) => ({
        ...s,
        isCompiling: false,
        compileResult: result,
        selectedPolicy: result.policy,
        routingPlan: null,
        isPlanComputed: false,
      }));
    } catch (err: unknown) {
      setState((s) => ({
        ...s,
        isCompiling: false,
        compileError: err instanceof Error ? err.message : "Compile failed.",
      }));
    }
  }, [state.policyText]);

  const loadExamplePolicy = useCallback(
    (policy: PolicySpec, name: string) => {
      const validated = PolicySpecSchema.parse(policy);
      setState((s) => ({
        ...s,
        selectedPolicy: validated,
        policyText: name,
        compileResult: null,
        routingPlan: null,
        isPlanComputed: false,
      }));
    },
    []
  );

  // ── Fetch Context ───────────────────────────────────────────────────────────
  const fetchContext = useCallback(async () => {
    if (!vaultRef.current || !state.walletAddress) return;
    setState((s) => ({ ...s, isFetchingContext: true }));
    try {
      const vault = vaultRef.current;
      const addr = state.walletAddress;

      const [block, vaultStateRaw, usdcxBalance] = await Promise.all([
        vault.getCurrentBlockHeight(addr),
        vault.getVaultState(addr),
        fetchUsdcxBalance(addr),
      ]);

      setState((s) => ({
        ...s,
        currentBlock: block,
        vaultState: {
          unlocked: String((vaultStateRaw as { unlockedBalance?: unknown })?.unlockedBalance ?? "0"),
          locked: String((vaultStateRaw as { lockedBalance?: unknown })?.lockedBalance ?? "0"),
          lockUntilBlock: Number((vaultStateRaw as { lockUntilBlock?: unknown })?.lockUntilBlock ?? 0),
        },
        usdcxBalance,
        isFetchingContext: false,
      }));
    } catch {
      setState((s) => ({ ...s, isFetchingContext: false }));
    }
  }, [state.walletAddress]);

  // Auto-fetch context when wallet connects
  useEffect(() => {
    if (state.walletAddress) {
      fetchContext();
    }
  }, [state.walletAddress]); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-derive behavior signals whenever policy, block, or history changes
  useEffect(() => {
    if (!state.selectedPolicy || !state.walletAddress || state.currentBlock === null) return;
    const policy: PolicySpec = state.splitAddressOverride.trim()
      ? {
          ...state.selectedPolicy,
          baseline: {
            ...state.selectedPolicy.baseline,
            splitAddress: state.splitAddressOverride.trim(),
          },
        }
      : state.selectedPolicy;
    
    const signals = deriveBehaviorSignals(state.history, state.currentBlock, policy);
    setState((s) => ({ ...s, behaviorSignals: signals }));
  }, [state.selectedPolicy, state.walletAddress, state.currentBlock, state.history, state.splitAddressOverride]);

  // ── Compute Signals & Plan ─────────────────────────────────────────────────
  const previewPlan = useCallback(() => {
    if (!state.selectedPolicy || !state.walletAddress) return;
    const block = state.currentBlock ?? Math.floor(Date.now() / 600_000);

    // Apply split address override if provided (e.g. payroll beneficiary)
    const policy: PolicySpec = state.splitAddressOverride.trim()
      ? {
          ...state.selectedPolicy,
          baseline: {
            ...state.selectedPolicy.baseline,
            splitAddress: state.splitAddressOverride.trim(),
          },
        }
      : state.selectedPolicy;

    const signals = deriveBehaviorSignals(
      state.history,
      block,
      policy
    );
    const plan = engine(
      signals,
      policy,
      state.depositAmountMicro,
      block
    );
    setState((s) => ({
      ...s,
      behaviorSignals: signals,
      routingPlan: plan,
      isPlanComputed: true,
      // Store the effective policy with any override baked in
      selectedPolicy: policy,
    }));
  }, [
    state.selectedPolicy,
    state.walletAddress,
    state.currentBlock,
    state.history,
    state.depositAmountMicro,
    state.splitAddressOverride,
  ]);

  // ── Execute ────────────────────────────────────────────────────────────────
  const executePlan = useCallback(async () => {
    if (!vaultRef.current || !state.routingPlan || !state.walletAddress) return;
    const vault = vaultRef.current;
    const plan = state.routingPlan;
    const address = state.walletAddress;
    const block = state.currentBlock ?? Math.floor(Date.now() / 600_000);

    setState((s) => ({ ...s, isExecuting: true, executeError: null }));
    try {
      // 1. setRoutingRules
      const setRulesResult = await vault.setRoutingRules({
        lockAmount: plan.lockAmountMicro,
        lockUntilBlock: plan.lockUntilBlock,
        splitAddress: plan.splitAddress ?? "",
        splitAmount: plan.splitAmountMicro,
      });
      const setRulesTxId = extractTxId(setRulesResult);

      // 2. deposit
      const depositResult = await vault.deposit(state.depositAmountMicro);
      const depositTxId = extractTxId(depositResult);

      const now = new Date().toISOString();
      const newEntries: HistoryLogEntry[] = [
        {
          address,
          blockHeight: block,
          timestampIso: now,
          eventType: "setRoutingRules",
          amountMicro: null,
          wasEarlyWithdraw: null,
          txId: setRulesTxId,
        },
        {
          address,
          blockHeight: block,
          timestampIso: now,
          eventType: "deposit",
          amountMicro: state.depositAmountMicro,
          wasEarlyWithdraw: null,
          txId: depositTxId,
        },
      ];

      const updatedHistory = [...state.history, ...newEntries];
      saveHistory(address, updatedHistory);

      const newTxs: TxRecord[] = [
        {
          txId: setRulesTxId,
          type: "setRoutingRules",
          blockHeight: block,
          timestamp: now,
          explorerUrl: EXPLORER_BASE + setRulesTxId + "?chain=testnet",
        },
        {
          txId: depositTxId,
          type: "deposit",
          blockHeight: block,
          timestamp: now,
          explorerUrl: EXPLORER_BASE + depositTxId + "?chain=testnet",
        },
      ];

      setState((s) => ({
        ...s,
        isExecuting: false,
        history: updatedHistory,
        lastTxs: [...newTxs, ...s.lastTxs].slice(0, 20),
        routingPlan: null,
        isPlanComputed: false,
      }));

      await fetchContext();
    } catch (err: unknown) {
      setState((s) => ({
        ...s,
        isExecuting: false,
        executeError:
          err instanceof Error ? err.message : "Transaction failed.",
      }));
    }
  }, [
    state.routingPlan,
    state.walletAddress,
    state.currentBlock,
    state.depositAmountMicro,
    state.history,
    fetchContext,
  ]);

  // ── Withdraw ───────────────────────────────────────────────────────────────
  // Withdraws from the vault's unlocked balance.
  // wasEarlyWithdraw = true if the vault still has locked funds at withdraw time
  // (user cleared the routing rules and withdrew during an active lock period).
  const withdrawFromVault = useCallback(async () => {
    if (!vaultRef.current || !state.walletAddress) return;
    const vault = vaultRef.current;
    const address = state.walletAddress;
    const block = state.currentBlock ?? Math.floor(Date.now() / 600_000);

    setState((s) => ({ ...s, isWithdrawing: true, withdrawError: null }));
    try {
      // Determine wasEarlyWithdraw before the tx goes through
      const hasLocked = await vault.hasLockedFunds(address);
      const wasEarlyWithdraw = Boolean(hasLocked);

      const withdrawResult = await vault.withdraw(state.withdrawAmountMicro);
      const withdrawTxId = extractTxId(withdrawResult);

      const now = new Date().toISOString();
      const entry: HistoryLogEntry = {
        address,
        blockHeight: block,
        timestampIso: now,
        eventType: "withdraw",
        amountMicro: state.withdrawAmountMicro,
        wasEarlyWithdraw,
        txId: withdrawTxId,
      };

      const updatedHistory = [...state.history, entry];
      saveHistory(address, updatedHistory);

      const newTx: TxRecord = {
        txId: withdrawTxId,
        type: "withdraw",
        blockHeight: block,
        timestamp: now,
        explorerUrl: EXPLORER_BASE + withdrawTxId + "?chain=testnet",
      };

      setState((s) => ({
        ...s,
        isWithdrawing: false,
        history: updatedHistory,
        lastTxs: [newTx, ...s.lastTxs].slice(0, 20),
      }));

      await fetchContext();
    } catch (err: unknown) {
      setState((s) => ({
        ...s,
        isWithdrawing: false,
        withdrawError:
          err instanceof Error ? err.message : "Withdraw failed.",
      }));
    }
  }, [
    state.walletAddress,
    state.currentBlock,
    state.withdrawAmountMicro,
    state.history,
    fetchContext,
  ]);

  const setAutoExecute = useCallback((v: boolean) => {
    setState((s) => ({ ...s, autoExecute: v }));
  }, []);

  const setDepositAmount = useCallback((v: string) => {
    setState((s) => ({ ...s, depositAmountMicro: v }));
  }, []);

  const setWithdrawAmount = useCallback((v: string) => {
    setState((s) => ({ ...s, withdrawAmountMicro: v }));
  }, []);

  const setSplitAddressOverride = useCallback((v: string) => {
    setState((s) => ({ ...s, splitAddressOverride: v }));
  }, []);

  const clearHistory = useCallback(() => {
    if (!state.walletAddress) return;
    saveHistory(state.walletAddress, []);
    setState((s) => ({
      ...s,
      history: [],
      behaviorSignals: null,
      routingPlan: null,
      isPlanComputed: false,
    }));
  }, [state.walletAddress]);

  return {
    ...state,
    connectWallet,
    disconnectWallet,
    setPolicyText,
    compilePolicy,
    loadExamplePolicy,
    fetchContext,
    previewPlan,
    executePlan,
    withdrawFromVault,
    setAutoExecute,
    setDepositAmount,
    setWithdrawAmount,
    setSplitAddressOverride,
    clearHistory,
  };
}

function extractTxId(result: unknown): string {
  if (typeof result === "string") return result;
  if (result && typeof result === "object") {
    const r = result as Record<string, unknown>;
    if (typeof r.txId === "string") return r.txId;
    if (typeof r.txid === "string") return r.txid;
  }
  return `mock-tx-${Date.now()}`;
}
