"use client";

import { useState, useEffect } from "react";
import { useCovenant } from "../hooks/useCovenant";
import type { PolicySpec } from "@covenant/core";

// ── Example policies (loaded from task §10 specs) ──────────────────────────────
const EXAMPLE_POLICIES: Array<{
  id: string;
  icon: string;
  name: string;
  shortDesc: string;
  englishSource: string;
  policy: PolicySpec;
}> = [
  {
    id: "vesting",
    icon: "🔒",
    name: "Vesting — Strict After Early Withdraw",
    shortDesc: "Lock escalates on bad behavior",
    englishSource:
      "Lock 40% of each deposit for 15 days. If someone withdraws early twice in a row, lock 70% for 30 days until they go back to honoring locks.",
    policy: {
      name: "vesting-strict-after-early-withdraw",
      baseline: { lockPercent: 40, lockDurationBlocks: 2160, splitAddress: null, splitPercent: 0 },
      adjustments: [
        { when: "early_withdraw_streak", thresholdCount: 2, effect: { lockPercentDelta: 30, lockDurationDeltaBlocks: 2160 }, decay: "reset_on_opposite" },
      ],
      bounds: { minLockPercent: 0, maxLockPercent: 90, minLockDurationBlocks: 144, maxLockDurationBlocks: 52560 },
    },
  },
  {
    id: "savings",
    icon: "📈",
    name: "Savings — Loosens With Discipline",
    shortDesc: "Reward consistent behavior",
    englishSource:
      "Lock 60% of every deposit for 30 days as a savings discipline. After three honored locks in a row, ease up to a lighter lock.",
    policy: {
      name: "savings-loosens-with-discipline",
      baseline: { lockPercent: 60, lockDurationBlocks: 4320, splitAddress: null, splitPercent: 0 },
      adjustments: [
        { when: "honored_lock_streak", thresholdCount: 3, effect: { lockPercentDelta: -25, lockDurationDeltaBlocks: -1440 }, decay: "reset_on_opposite" },
      ],
      bounds: { minLockPercent: 0, maxLockPercent: 90, minLockDurationBlocks: 144, maxLockDurationBlocks: 52560 },
    },
  },
  {
    id: "payroll",
    icon: "💸",
    name: "Payroll — Split Only",
    shortDesc: "20% to contributor, rest liquid",
    englishSource:
      "Every deposit, send 20% straight to our contributor payout address, keep the rest liquid.",
    policy: {
      name: "payroll-split-only",
      baseline: { lockPercent: 0, lockDurationBlocks: 144, splitAddress: "ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM", splitPercent: 20 },
      adjustments: [],
      bounds: { minLockPercent: 0, maxLockPercent: 90, minLockDurationBlocks: 144, maxLockDurationBlocks: 52560 },
    },
  },
  {
    id: "treasury",
    icon: "🏛️",
    name: "Treasury — Tightens on Outflow Spike",
    shortDesc: "Protects reserves on anomalies",
    englishSource:
      "Keep 30% of the treasury locked normally. If we see 3+ large withdrawals in a single day, lock 65% for the next two cycles to protect the reserve.",
    policy: {
      name: "treasury-tightens-on-outflow-spike",
      baseline: { lockPercent: 30, lockDurationBlocks: 720, splitAddress: null, splitPercent: 0 },
      adjustments: [
        { when: "outflow_velocity_spike", thresholdCount: 3, thresholdWindowBlocks: 144, effect: { lockPercentDelta: 35, lockDurationDeltaBlocks: 2880 }, decay: "expires_after_n_cycles", decayCycles: 2 },
      ],
      bounds: { minLockPercent: 0, maxLockPercent: 90, minLockDurationBlocks: 144, maxLockDurationBlocks: 52560 },
    },
  },
  {
    id: "trust",
    icon: "🌱",
    name: "Hold Until Trust Established",
    shortDesc: "Lock appears only on bad behavior",
    englishSource:
      "By default, don't lock anything — keep it all liquid. But the moment someone withdraws early even once, start locking 40% for 10 days until trust is rebuilt.",
    policy: {
      name: "hold-until-trust-established",
      baseline: { lockPercent: 0, lockDurationBlocks: 144, splitAddress: null, splitPercent: 0 },
      adjustments: [
        { when: "early_withdraw_streak", thresholdCount: 1, effect: { lockPercentDelta: 40, lockDurationDeltaBlocks: 1440 }, decay: "reset_on_opposite" },
      ],
      bounds: { minLockPercent: 0, maxLockPercent: 90, minLockDurationBlocks: 144, maxLockDurationBlocks: 52560 },
    },
  },
];

function formatMicro(micro: string): string {
  const val = Number(BigInt(micro)) / 1_000_000;
  return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function microToPercent(micro: string, depositMicro: string): string {
  if (depositMicro === "0") return "0";
  const pct = (Number(BigInt(micro)) / Number(BigInt(depositMicro))) * 100;
  return pct.toFixed(1);
}

type CovenantHook = ReturnType<typeof useCovenant>;

// function SplitterRegistryCard({ cov }: { cov: CovenantHook }) {
//   const [draft, setDraft] = useState<Array<{ recipient: string; bps: string }>>([
//     { recipient: "", bps: "" },
//   ]);
//   const [isEditing, setIsEditing] = useState(false);

//   useEffect(() => {
//     if (cov.walletAddress) {
//       cov.fetchRegistry();
//     }
//     // eslint-disable-next-line react-hooks/exhaustive-deps
//   }, [cov.walletAddress]);

//   function startEditing() {
//     if (cov.registry.length > 0) {
//       setDraft(cov.registry.map((r) => ({ recipient: r.recipient, bps: r.bps.toString() })));
//     } else {
//       setDraft([{ recipient: "", bps: "" }]);
//     }
//     setIsEditing(true);
//   }

//   function updateRow(index: number, field: "recipient" | "bps", value: string) {
//     setDraft((rows) => rows.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
//   }

//   function addRow() {
//     if (draft.length >= 5) return;
//     setDraft((rows) => [...rows, { recipient: "", bps: "" }]);
//   }

//   function removeRow(index: number) {
//     setDraft((rows) => rows.filter((_, i) => i !== index));
//   }

//   const bpsSum = draft.reduce((sum, r) => sum + (parseInt(r.bps, 10) || 0), 0);
//   const sumIsValid = bpsSum === 10000;
//   const allAddressesValid = draft.every(
//     (r) => r.recipient.trim().match(/^(ST|SP)[A-Z0-9]{28,40}$/i)
//   );
//   const canSubmit = draft.length > 0 && draft.length <= 5 && sumIsValid && allAddressesValid;

//   async function handleSubmit() {
//     const entries = draft.map((r) => ({
//       recipient: r.recipient.trim(),
//       bps: parseInt(r.bps, 10),
//     }));
//     await cov.setRegistry(entries);
//     setIsEditing(false);
//   }

//   return (
//     <div className="card">
//       <div className="card-header">
//         <div className="card-title">
//           <div className="card-icon" style={{ background: "rgba(139,92,246,0.15)" }}>📋</div>
//           Splitter Registry
//         </div>
//         <button
//           id="btn-refresh-registry"
//           className="btn btn-secondary btn-sm"
//           onClick={cov.fetchRegistry}
//           disabled={cov.isFetchingRegistry}
//         >
//           {cov.isFetchingRegistry ? <><div className="spinner" />Fetching...</> : "🔄 Refresh"}
//         </button>
//       </div>
//       <div className="card-body">
//         <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
//           Up to 5 recipients, shares must sum to exactly 10000 basis points
//           (100%). Editing is only possible when the splitter's live USDCx
//           balance is zero - the contract enforces this on-chain to prevent
//           changing shares while funds are already owed under the current
//           configuration.
//         </p>

//         {!isEditing ? (
//           <>
//             {cov.registry.length === 0 ? (
//               <div className="empty-state">
//                 <div className="empty-icon">📭</div>
//                 <div className="empty-text">No recipients configured yet.</div>
//               </div>
//             ) : (
//               <div className="tx-list" style={{ marginBottom: 16 }}>
//                 {cov.registry.filter((r) => typeof r.recipient === "string").map((r) => (
//                     <div key={r.recipient} className="tx-item">
//                     <span className="tx-hash">{r.recipient.slice(0, 10)}...{r.recipient.slice(-6)}</span>
//                     <span style={{ fontSize: 13, fontWeight: 700, color: "var(--accent-purple)" }}>
//                       {(Number(r.bps) / 100).toFixed(2)}%
//                     </span>
//                   </div>
//                 ))}
//               </div>
//             )}

//             <button
//               id="btn-edit-registry"
//               className="btn btn-secondary"
//               style={{ width: "100%" }}
//               onClick={startEditing}
//               disabled={!cov.walletAddress}
//             >
//               ✏️ Edit Registry
//             </button>
//           </>
//         ) : (
//           <>
//             {draft.map((row, i) => (
//               <div key={i} style={{ display: "flex", gap: 8, marginBottom: 8, alignItems: "center" }}>
//                 <input
//                   className="form-input"
//                   type="text"
//                   placeholder="ST... or SP... address"
//                   value={row.recipient}
//                   onChange={(e) => updateRow(i, "recipient", e.target.value)}
//                   style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12, flex: 2 }}
//                 />
//                 <input
//                   className="form-input"
//                   type="number"
//                   placeholder="bps"
//                   value={row.bps}
//                   onChange={(e) => updateRow(i, "bps", e.target.value)}
//                   style={{ flex: 1 }}
//                 />
//                 <button
//                   className="btn btn-danger btn-sm"
//                   onClick={() => removeRow(i)}
//                   disabled={draft.length <= 1}
//                 >
//                   X
//                 </button>
//               </div>
//             ))}

//             <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
//               <button
//                 className="btn btn-secondary btn-sm"
//                 onClick={addRow}
//                 disabled={draft.length >= 5}
//               >
//                 + Add Recipient
//               </button>
//               <span style={{ fontSize: 13, fontWeight: 700, color: sumIsValid ? "var(--accent-green)" : "var(--accent-red)" }}>
//                 Total: {bpsSum} / 10000 bps
//               </span>
//             </div>

//             {!allAddressesValid && draft.some((r) => r.recipient.trim() !== "") && (
//               <div className="alert alert-warn" style={{ marginBottom: 12 }}>
//                 <span className="alert-icon">⚠️</span>
//                 All addresses must be valid ST... or SP... Stacks principals.
//               </div>
//             )}

//             {cov.setRegistryError && (
//               <div className="alert alert-error" style={{ marginBottom: 12 }}>
//                 <span className="alert-icon">⚠️</span>{cov.setRegistryError}
//               </div>
//             )}

//             <div style={{ display: "flex", gap: 8 }}>
//               <button
//                 id="btn-submit-registry"
//                 className="btn btn-primary"
//                 style={{ flex: 1 }}
//                 onClick={handleSubmit}
//                 disabled={!canSubmit || cov.isSettingRegistry}
//               >
//                 {cov.isSettingRegistry ? (
//                   <><div className="spinner" /> Signing & Broadcasting...</>
//                 ) : (
//                   "Save Registry"
//                 )}
//               </button>
//               <button
//                 className="btn btn-secondary"
//                 onClick={() => setIsEditing(false)}
//                 disabled={cov.isSettingRegistry}
//               >
//                 Cancel
//               </button>
//             </div>
//           </>
//         )}
//       </div>
//     </div>
//   );
// }


export default function Home() {
  const cov = useCovenant();
  const [activeTab, setActiveTab] = useState<"compiler" | "plan" | "history">("compiler");
  const [selectedExampleId, setSelectedExampleId] = useState<string | null>(null);
  const [showConfirm, setShowConfirm] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(true);

  const liquidPercent =
    cov.routingPlan
      ? (
          100 -
          parseFloat(microToPercent(cov.routingPlan.lockAmountMicro, cov.depositAmountMicro)) -
          parseFloat(microToPercent(cov.routingPlan.splitAmountMicro, cov.depositAmountMicro))
        ).toFixed(1)
      : "100.0";

  function handleExecuteClick() {
    if (cov.autoExecute) {
      cov.executePlan();
    } else {
      setShowConfirm(true);
    }
  }

  function handleConfirm() {
    setShowConfirm(false);
    cov.executePlan();
  }

  const adjBadgeClass = (id: string) => {
    if (id === "honored_lock_streak") return "adj-badge loosen";
    if (id === "early_withdraw_streak") return "adj-badge tighten";
    if (id === "outflow_velocity_spike") return "adj-badge tighten";
    if (id === "deposit_cadence_broken") return "adj-badge warning";
    return "adj-badge neutral";
  };

  const adjLabel = (id: string) => {
    const map: Record<string, string> = {
      early_withdraw_streak: "⚠️ Early Withdraw Streak",
      honored_lock_streak: "✅ Honored Lock Streak",
      deposit_cadence_broken: "⏰ Cadence Broken",
      outflow_velocity_spike: "🚨 Outflow Spike",
    };
    return map[id] ?? id;
  };

  const txTypeBadge = (type: string) => {
    if (type === "deposit") return "tx-type-badge deposit";
    if (type === "withdraw") return "tx-type-badge withdraw";
    return "tx-type-badge setrules";
  };

  return (
    <>
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="header">
        <div className="container">
          <div className="header-inner">
            <div className="logo">
              <div className="logo-icon">⚖️</div>
              <div>
                <div className="logo-text">Covenant</div>
                <div className="logo-sub">Behavioral Vesting Engine</div>
              </div>
            </div>
            <div className="header-right">
              <div className="network-badge">Testnet</div>
              {cov.walletAddress ? (
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <div className="wallet-address" style={{ padding: "6px 12px" }}>
                    <div className="wallet-dot" />
                    {cov.walletAddress.slice(0, 8)}...{cov.walletAddress.slice(-6)}
                  </div>
                  <button
                    id="btn-disconnect"
                    className="btn btn-secondary btn-sm"
                    onClick={cov.disconnectWallet}
                  >
                    Disconnect
                  </button>
                </div>
              ) : (
                <button
                  id="btn-connect-wallet-header"
                  className="btn btn-primary"
                  onClick={cov.connectWallet}
                  disabled={cov.isConnecting}
                >
                  {cov.isConnecting ? (
                    <><div className="spinner" /> Connecting...</>
                  ) : (
                    "Connect Wallet"
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* ── Onboarding Modal ─────────────────────────────────────────────────── */}
      {showOnboarding && (
        <div className="modal-backdrop">
          <div className="modal fade-in-up" style={{ maxWidth: 600 }}>
            <div className="modal-header">
              <h3>👋 Welcome to Covenant</h3>
              <button className="btn-close" onClick={() => setShowOnboarding(false)}>×</button>
            </div>
            <div className="modal-body" style={{ lineHeight: 1.6, color: "var(--text-secondary)" }}>
              <p style={{ marginBottom: 16 }}>
                <strong>Covenant</strong> is a Behavioral Vesting Engine built on FlowVault-v2 for the Stacks testnet.
                It uses natural language policies to generate deterministic, adaptive routing rules.
              </p>
              <div style={{ background: "var(--bg-glass)", padding: 16, borderRadius: "var(--radius-md)", marginBottom: 16 }}>
                <h4 style={{ color: "var(--text-primary)", marginBottom: 8 }}>How to use it:</h4>
                <ol style={{ paddingLeft: 20 }}>
                  <li style={{ marginBottom: 4 }}><strong>Connect</strong> your Leather/Hiro wallet (Testnet).</li>
                  <li style={{ marginBottom: 4 }}><strong>Pick an example policy</strong> on the left (e.g. Vesting or Payroll).</li>
                  <li style={{ marginBottom: 4 }}><strong>Preview</strong> the routing plan to see what the AI generated.</li>
                  <li><strong>Execute</strong> the plan to deposit test USDCx and set rules.</li>
                </ol>
              </div>
              <p style={{ fontSize: 13 }}>
                <em>Note on Payroll:</em> FlowVault-v2 only supports a single split address per user. For <strong>multi-address payroll</strong>, you would execute multiple deposits (one for each beneficiary), or deploy a separate "Splitter" contract for FlowVault to route to.
              </p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-primary" style={{ width: "100%" }} onClick={() => setShowOnboarding(false)}>
                Get Started
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Main ───────────────────────────────────────────────────────────── */}
      <main className="main-content">
        <div className="container">
          {/* Hero */}
          <div className="hero fade-in">
            <h1 className="hero-title">
              Routing rules that <span className="gradient-text">adapt</span><br />
              to on-chain behavior
            </h1>
            <p className="hero-subtitle">
              One engine. Four use cases. Plain-English policy compiled to
              deterministic, behavior-adaptive FlowVault routing — vesting,
              savings, treasury, and payroll in a single config.
            </p>
          </div>

          {/* Vault Viewer */}
          {cov.walletAddress && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 24, marginBottom: 40 }} className="fade-in-up">
              
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 16 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 3, background: "var(--accent-green)" }} />
                  Wallet
                </div>
                <div style={{ fontSize: 32, fontWeight: 700 }}>
                  {cov.usdcxBalance ? formatMicro(cov.usdcxBalance) : "0.00"} <span style={{ fontSize: 16, color: "var(--text-muted)", fontWeight: 500 }}>USDCx</span>
                </div>
              </div>
              
              <div className="card" style={{ padding: 24 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 16 }}>
                  <div style={{ width: 6, height: 6, borderRadius: 3, background: "var(--accent-brand)" }} />
                  Vault Assets
                </div>
                <div style={{ fontSize: 32, fontWeight: 700 }}>
                  {cov.vaultState ? formatMicro(String(BigInt(cov.vaultState.unlocked) + BigInt(cov.vaultState.locked))) : "0.00"} <span style={{ fontSize: 16, color: "var(--text-muted)", fontWeight: 500 }}>USDCx</span>
                </div>
              </div>

              <div className="card" style={{ padding: 24, display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: 1, color: "var(--text-muted)", textTransform: "uppercase", marginBottom: 16 }}>
                  Liquidity
                </div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end" }}>
                  <div>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", fontWeight: 600 }}>Unlocked</div>
                    <div style={{ fontSize: 24, fontWeight: 600 }}>{cov.vaultState ? formatMicro(cov.vaultState.unlocked) : "0.00"}</div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 4, textTransform: "uppercase", fontWeight: 600 }}>Locked</div>
                    <div style={{ fontSize: 24, fontWeight: 600 }}>{cov.vaultState ? formatMicro(cov.vaultState.locked) : "0.00"}</div>
                  </div>
                </div>
              </div>

            </div>
          )}

          {/* Dashboard */}
          <div className="dashboard-grid fade-in-up">
            {/* Left: Policy Compiler Panel */}
            <div>
              <div className="card">
                <div className="card-header">
                  <div className="card-title">
                    <div className="card-icon" style={{ background: "rgba(139,92,246,0.15)" }}>🧠</div>
                    Policy Compiler
                  </div>
                  {cov.compileResult && (
                    <div className={`provider-badge ${cov.compileResult.usedFallback ? "fallback" : cov.compileResult.provider}`}>
                      {cov.compileResult.provider === "local-rules" ? "🔑 Local Rules" :
                       cov.compileResult.provider === "gemini" ? "✨ Gemini" :
                       "⚡ Groq"}
                    </div>
                  )}
                </div>
                <div className="card-body">
                  {/* Example Policy Chips */}
                  <div className="form-label">Example Policies</div>
                  <div className="policy-examples">
                    {EXAMPLE_POLICIES.map((ex) => (
                      <button
                        key={ex.id}
                        id={`policy-example-${ex.id}`}
                        className={`policy-chip ${selectedExampleId === ex.id ? "active" : ""}`}
                        onClick={() => {
                          setSelectedExampleId(ex.id);
                          cov.loadExamplePolicy(ex.policy, ex.name);
                          cov.setPolicyText(ex.englishSource);
                        }}
                      >
                        <span className="policy-chip-icon">{ex.icon}</span>
                        <span className="policy-chip-text">
                          <div className="policy-chip-name">{ex.name}</div>
                          <div className="policy-chip-desc">{ex.shortDesc}</div>
                        </span>
                      </button>
                    ))}
                  </div>

                  <div className="divider" />

                  {/* English Policy Input */}
                  <div className="form-group">
                    <label className="form-label" htmlFor="policy-text-input">
                      Or write your own policy in English
                    </label>
                    <textarea
                      id="policy-text-input"
                      className="form-textarea"
                      placeholder="e.g. Lock 50% for 30 days. Tighten to 80% if someone withdraws early twice in a row..."
                      value={cov.policyText}
                      onChange={(e) => cov.setPolicyText(e.target.value)}
                      rows={4}
                    />
                  </div>

                  {cov.compileError && (
                    <div className="alert alert-error">
                      <span className="alert-icon">⚠️</span>
                      {cov.compileError}
                    </div>
                  )}

                  {cov.compileResult?.warnings.map((w, i) => (
                    <div key={i} className="alert alert-warn">
                      <span className="alert-icon">⚠️</span>
                      {w.message}
                    </div>
                  ))}

                  {cov.compileResult?.usedFallback && cov.compileResult.fallbackReason && (
                    <div className="alert alert-warn">
                      <span className="alert-icon">🔄</span>
                      {cov.compileResult.fallbackReason}
                    </div>
                  )}

                  <button
                    id="btn-compile-policy"
                    className="btn btn-primary"
                    style={{ width: "100%", marginBottom: 12 }}
                    onClick={cov.compilePolicy}
                    disabled={cov.isCompiling || !cov.policyText.trim()}
                  >
                    {cov.isCompiling ? (
                      <><div className="spinner" /> Compiling...</>
                    ) : (
                      "⚡ Compile Policy"
                    )}
                  </button>

                  {/* PolicySpec JSON preview */}
                  {cov.selectedPolicy && (
                    <>
                      <div className="form-label">PolicySpec JSON</div>
                      <div className="code-block">
                        {JSON.stringify(cov.selectedPolicy, null, 2)}
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Right: Main workflow panels */}
            <div className="right-stack">
              {/* Wallet Connect */}
              {!cov.walletAddress ? (
                <div className="card">
                  <div className="wallet-section">
                    <div className="wallet-icon">👛</div>
                    <div className="wallet-title">Connect Your Wallet</div>
                    <p className="wallet-desc">
                      Connect a Leather or Hiro wallet (Stacks testnet) to fetch
                      on-chain state and execute routing rules.
                    </p>
                    {cov.connectError && (
                      <div className="alert alert-error" style={{ marginBottom: 16 }}>
                        <span className="alert-icon">⚠️</span>
                        {cov.connectError}
                      </div>
                    )}
                    <button
                      id="btn-connect-wallet-main"
                      className="btn btn-primary btn-lg"
                      onClick={cov.connectWallet}
                      disabled={cov.isConnecting}
                    >
                      {cov.isConnecting ? (
                        <><div className="spinner" /> Connecting...</>
                      ) : (
                        "Connect Wallet"
                      )}
                    </button>
                    <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 12 }}>
                      Uses wallet signing only — no private keys in browser
                    </p>
                  </div>
                </div>
              ) : (
                <>
                  {/* Vault State + Signals */}
                  <div className="card">
                    <div className="card-header">
                      <div className="card-title">
                        <div className="card-icon" style={{ background: "rgba(6,182,212,0.15)" }}>📊</div>
                        Behavior Signals
                      </div>
                      <button
                        id="btn-refresh-context"
                        className="btn btn-secondary btn-sm"
                        onClick={cov.fetchContext}
                        disabled={cov.isFetchingContext}
                      >
                        {cov.isFetchingContext ? <><div className="spinner" />Fetching...</> : "🔄 Refresh"}
                      </button>
                    </div>
                    <div className="card-body">
                      {/* USDCx balance strip */}
                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 16px",
                        background: "rgba(139,92,246,0.07)",
                        border: "1px solid rgba(139,92,246,0.2)",
                        borderRadius: "var(--radius-md)",
                        marginBottom: 16,
                        gap: 12,
                        flexWrap: "wrap",
                      }}>
                        <div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>
                            Wallet USDCx Balance
                          </div>
                          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color: "var(--accent-purple)" }}>
                            {cov.usdcxBalance !== null
                              ? `${formatMicro(cov.usdcxBalance)} USDCx`
                              : cov.isFetchingContext ? "loading…" : "—"}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>
                            Vault: {cov.vaultState ? `${formatMicro(cov.vaultState.unlocked)} unlocked · ${formatMicro(cov.vaultState.locked)} locked` : "—"}
                          </div>
                          {cov.vaultState && cov.currentBlock && cov.vaultState.lockUntilBlock > cov.currentBlock && (
                            <div style={{ fontSize: 11, color: "var(--accent-amber)", marginTop: 4, fontWeight: 600 }}>
                              ⏳ Unlocks in {cov.vaultState.lockUntilBlock - cov.currentBlock} blocks (~{Math.round((cov.vaultState.lockUntilBlock - cov.currentBlock) * 10 / 60 / 24)} days)
                            </div>
                          )}
                        </div>
                        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
                          <a
                            href={`https://explorer.hiro.so/address/${cov.walletAddress}?chain=testnet`}
                            target="_blank"
                            rel="noreferrer"
                            className="btn btn-secondary btn-sm"
                            style={{ textDecoration: "none" }}
                          >
                            Hiro Explorer ↗
                          </a>
                          {cov.usdcxBalance === "0" || cov.usdcxBalance === null ? (
                            <a
                              href="https://explorer.hiro.so/txid/ST1PQHQKV0RJXZFY1DGX8MNSNYVE3VGZJSRTPGZGM.usdcx?chain=testnet"
                              target="_blank"
                              rel="noreferrer"
                              className="btn btn-sm"
                              style={{ textDecoration: "none", background: "rgba(139,92,246,0.15)", color: "var(--accent-purple)", border: "1px solid rgba(139,92,246,0.3)" }}
                            >
                              Get test USDCx ↗
                            </a>
                          ) : null}
                        </div>
                      </div>

                      {cov.usdcxBalance === "0" && (
                        <div className="alert alert-warn" style={{ marginBottom: 16 }}>
                          <span className="alert-icon">💡</span>
                          <span>You need test USDCx to deposit. Click <strong>"Get test USDCx"</strong> above to visit the token contract on Hiro Explorer — look for a public <code>mint</code> function, or check the <a href="https://discord.gg/flowvault" target="_blank" rel="noreferrer" style={{ color: "inherit", textDecoration: "underline" }}>FlowVault Discord</a> for the faucet. Your STX is only needed for gas.</span>
                        </div>
                      )}

                      {cov.currentBlock && (
                        <div style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
                          📦 Block <strong style={{ color: "var(--text-secondary)" }}>{cov.currentBlock.toLocaleString()}</strong>
                        </div>
                      )}

                      <div className="stats-grid">
                        <div className="stat-card">
                          <div className="stat-label">Early Withdraws</div>
                          <div className={`stat-value ${(cov.behaviorSignals?.consecutiveEarlyWithdraws ?? 0) > 0 ? "bad" : "good"}`}>
                            {cov.behaviorSignals?.consecutiveEarlyWithdraws ?? 0}
                          </div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-label">Honored Locks</div>
                          <div className={`stat-value ${(cov.behaviorSignals?.consecutiveHonoredLocks ?? 0) > 0 ? "good" : "neutral"}`}>
                            {cov.behaviorSignals?.consecutiveHonoredLocks ?? 0}
                          </div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-label">Blocks Since Deposit</div>
                          <div className={`stat-value ${cov.behaviorSignals?.blocksSinceLastDeposit && cov.behaviorSignals.blocksSinceLastDeposit > 4320 ? "warning" : "neutral"}`}>
                            {cov.behaviorSignals?.blocksSinceLastDeposit ?? "—"}
                          </div>
                        </div>
                        <div className="stat-card">
                          <div className="stat-label">Outflow (24h)</div>
                          <div className={`stat-value ${(cov.behaviorSignals?.outflowLastWindow.withdrawCount ?? 0) >= 3 ? "bad" : "neutral"}`}>
                            {cov.behaviorSignals?.outflowLastWindow.withdrawCount ?? 0}
                          </div>
                        </div>
                      </div>

                      <div style={{ marginTop: 16 }}>
                        <div className="form-label">Deposit Amount</div>
                        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <input
                            id="deposit-amount-input"
                            className="form-input"
                            type="number"
                            value={Number(cov.depositAmountMicro) / 1_000_000}
                            min={0.000001}
                            step={0.1}
                            onChange={(e) => {
                              const usdcx = parseFloat(e.target.value) || 0;
                              cov.setDepositAmount(String(Math.round(usdcx * 1_000_000)));
                            }}
                            placeholder="1"
                          />
                          <span style={{ fontSize: 14, color: "var(--accent-purple)", fontWeight: 600, whiteSpace: "nowrap" }}>USDCx</span>
                        </div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                          = {cov.depositAmountMicro} micro-units · 1 USDCx = 1,000,000 µ
                        </div>
                      </div>

                      {/* Beneficiary / Split address — shown whenever policy has a split
                      {cov.selectedPolicy && cov.selectedPolicy.baseline.splitPercent > 0 && (
                        <div style={{ marginTop: 16 }}>
                          <div className="form-label">Beneficiary Address <span style={{ color: "var(--accent-purple)" }}>({cov.selectedPolicy.baseline.splitPercent}% split)</span></div>
                          <input
                            id="split-address-input"
                            className="form-input"
                            type="text"
                            value={cov.splitAddressOverride}
                            onChange={(e) => cov.setSplitAddressOverride(e.target.value)}
                            placeholder="ST... or SP... address"
                            style={{ fontFamily: "JetBrains Mono, monospace", fontSize: 12 }}
                          />
                          {cov.splitAddressOverride && !cov.splitAddressOverride.match(/^(ST|SP)[A-Z0-9]{28,40}$/i) && (
                            <div style={{ fontSize: 11, color: "var(--accent-red)", marginTop: 4 }}>
                              ⚠ Must be a valid Stacks address (ST... or SP...)
                            </div>
                          )}
                          {!cov.splitAddressOverride && (
                            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>
                              Required for payroll/split policies. Enter the recipient&apos;s ST... address.
                            </div>
                          )}
                        </div>
                      )} */}

                      <button
                        id="btn-preview-plan"
                        className="btn btn-secondary"
                        style={{ width: "100%", marginTop: 16 }}
                        onClick={cov.previewPlan}
                        disabled={!cov.selectedPolicy}
                      >
                        🗺️ Preview Routing Plan
                      </button>
                    </div>
                  </div>

                  
                  
                  {/* ── Splitter Claim Card ──
                  <div className="card">
                    <div className="card-header">
                      <div className="card-title">
                        <div className="card-icon" style={{ background: "rgba(16,185,129,0.15)" }}>💰</div>
                        Splitter Claim
                      </div>
                      <button
                        id="btn-refresh-claimable"
                        className="btn btn-secondary btn-sm"
                        onClick={cov.fetchContext}
                        disabled={cov.isFetchingContext}
                      >
                        {cov.isFetchingContext ? <><div className="spinner" />Fetching...</> : "🔄 Refresh"}
                      </button>
                    </div>
                    <div className="card-body">
                      <p style={{ fontSize: 12, color: "var(--text-muted)", marginBottom: 16 }}>
                        If your connected wallet is a registered recipient on the Covenant
                        Splitter contract, any USDCx routed there via a FlowVault split can be
                        claimed here. Shares are fixed per registry configuration — see the
                        Registry panel below for the current setup.
                      </p>

                      <div style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "12px 16px",
                        background: "rgba(16,185,129,0.07)",
                        border: "1px solid rgba(16,185,129,0.2)",
                        borderRadius: "var(--radius-md)",
                        marginBottom: 16,
                      }}>
                        <div>
                          <div style={{ fontSize: 11, color: "var(--text-muted)", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.6px", marginBottom: 4 }}>
                            Your Claimable Amount
                          </div>
                          <div style={{ fontSize: 22, fontWeight: 700, fontFamily: "JetBrains Mono, monospace", color: "var(--accent-green)" }}>
                            {cov.claimableAmount !== null
                              ? `${formatMicro(cov.claimableAmount.toString())} USDCx`
                              : cov.isFetchingContext ? "loading…" : "—"}
                          </div>
                        </div>
                      </div>

                      {cov.claimError && (
                        <div className="alert alert-error" style={{ marginBottom: 12 }}>
                          <span className="alert-icon">⚠️</span>{cov.claimError}
                        </div>
                      )}

                      <button
                        id="btn-claim-splitter"
                        className="btn btn-success btn-lg"
                        style={{ width: "100%" }}
                        onClick={cov.claimSplitter}
                        disabled={cov.isClaiming || !cov.claimableAmount || cov.claimableAmount === 0n}
                      >
                        {cov.isClaiming ? (
                          <><div className="spinner" /> Signing & Broadcasting...</>
                        ) : (
                          "💰 Claim My Share"
                        )}
                      </button>
                    </div>
                  </div> */}

                  {/* ── Splitter Registry Management Card ──
                  <SplitterRegistryCard cov={cov} /> */}

                  {/* Routing Plan */}
                  {cov.routingPlan && (
                    <div className="card fade-in-up">
                      <div className="card-header">
                        <div className="card-title">
                          <div className="card-icon" style={{ background: "rgba(16,185,129,0.15)" }}>🗺️</div>
                          Routing Plan
                        </div>
                        {cov.routingPlan.appliedAdjustmentIds.length > 0 ? (
                          <span style={{ fontSize: 12, color: "var(--accent-amber)", fontWeight: 600 }}>
                            ⚡ Adjusted
                          </span>
                        ) : (
                          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                            Baseline
                          </span>
                        )}
                      </div>
                      <div className="card-body">
                        {/* Allocation breakdown */}
                        <div className="plan-summary">
                          <div className="plan-item lock">
                            <div className="plan-item-label">🔒 Lock</div>
                            <div className="plan-item-value">
                              {microToPercent(cov.routingPlan.lockAmountMicro, cov.depositAmountMicro)}%
                            </div>
                            <div className="plan-item-sub">
                              {formatMicro(cov.routingPlan.lockAmountMicro)} tokens
                            </div>
                          </div>
                          <div className="plan-item split">
                            <div className="plan-item-label">↗️ Split</div>
                            <div className="plan-item-value">
                              {microToPercent(cov.routingPlan.splitAmountMicro, cov.depositAmountMicro)}%
                            </div>
                            <div className="plan-item-sub">
                              {cov.routingPlan.splitAddress
                                ? `${cov.routingPlan.splitAddress.slice(0, 6)}...`
                                : "none"}
                            </div>
                          </div>
                          <div className="plan-item liquid">
                            <div className="plan-item-label">💧 Liquid</div>
                            <div className="plan-item-value">{liquidPercent}%</div>
                            <div className="plan-item-sub">available immediately</div>
                          </div>
                        </div>

                        <div style={{ marginBottom: 12, fontSize: 12, color: "var(--text-muted)" }}>
                          Lock until block <strong style={{ color: "var(--text-secondary)" }}>{cov.routingPlan.lockUntilBlock.toLocaleString()}</strong>
                          {cov.currentBlock && (
                            <> (~{Math.round((cov.routingPlan.lockUntilBlock - cov.currentBlock) / 144)} days)</>
                          )}
                        </div>

                        {/* Rationale */}
                        <div className="rationale-box">
                          <strong>Rationale:</strong> {cov.routingPlan.rationale}
                        </div>

                        {/* Applied adjustments */}
                        <div className="adj-badges">
                          {cov.routingPlan.appliedAdjustmentIds.length === 0 ? (
                            <span className="adj-badge none">✓ Baseline — no adjustments</span>
                          ) : (
                            cov.routingPlan.appliedAdjustmentIds.map((id) => (
                              <span key={id} className={adjBadgeClass(id)}>
                                {adjLabel(id)}
                              </span>
                            ))
                          )}
                        </div>

                        {/* Auto-execute toggle */}
                        <div className="auto-execute-toggle">
                          <div className="toggle-info">
                            <div className="toggle-label">Auto-Execute</div>
                            <div className="toggle-desc">
                              Signs immediately when triggered (opt-in). Default: confirm first.
                            </div>
                          </div>
                          <label className="toggle-switch">
                            <input
                              id="toggle-auto-execute"
                              type="checkbox"
                              checked={cov.autoExecute}
                              onChange={(e) => cov.setAutoExecute(e.target.checked)}
                            />
                            <span className="toggle-slider" />
                          </label>
                        </div>

                        {cov.executeError && (
                          <div className="alert alert-error" style={{ marginTop: 12 }}>
                            <span className="alert-icon">❌</span>
                            {cov.executeError}
                          </div>
                        )}

                        {/* Confirm modal */}
                        {showConfirm && (
                          <div className="alert alert-info" style={{ marginTop: 12, flexDirection: "column", gap: 12 }}>
                            <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                              <span className="alert-icon">ℹ️</span>
                              <span>
                                Execute: setRoutingRules (lock {microToPercent(cov.routingPlan.lockAmountMicro, cov.depositAmountMicro)}%, split {microToPercent(cov.routingPlan.splitAmountMicro, cov.depositAmountMicro)}%) then deposit {formatMicro(cov.depositAmountMicro)} tokens?
                              </span>
                            </div>
                            <div style={{ display: "flex", gap: 8 }}>
                              <button id="btn-confirm-execute" className="btn btn-success btn-sm" onClick={handleConfirm}>
                                ✅ Confirm & Sign
                              </button>
                              <button id="btn-cancel-execute" className="btn btn-danger btn-sm" onClick={() => setShowConfirm(false)}>
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}

                        <button
                          id="btn-execute-plan"
                          className="btn btn-success btn-lg"
                          style={{ width: "100%", marginTop: 12 }}
                          onClick={handleExecuteClick}
                          disabled={cov.isExecuting}
                        >
                          {cov.isExecuting ? (
                            <><div className="spinner" /> Signing & Broadcasting...</>
                          ) : (
                            "🚀 Execute Plan"
                          )}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* ── Withdraw Panel ── */}
                  <div className="card">
                    <div className="card-header">
                      <div className="card-title">
                        <div className="card-icon" style={{ background: "rgba(239,68,68,0.12)" }}>💸</div>
                        Withdraw from Vault
                      </div>
                      {cov.vaultState && (
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          Available: <strong style={{ color: "var(--accent-green)" }}>{formatMicro(cov.vaultState.unlocked)} USDCx</strong>
                        </span>
                      )}
                    </div>
                    <div className="card-body">
                      {cov.vaultState && BigInt(cov.vaultState.locked) > BigInt(0) && (
                        <div className="alert alert-warn" style={{ marginBottom: 12 }}>
                          <span className="alert-icon">🔒</span>
                          <span><strong>{formatMicro(cov.vaultState.locked)} USDCx</strong> is currently locked. Withdrawing now will be recorded as an <strong>early withdraw</strong> — the engine will tighten rules on the next cycle.</span>
                        </div>
                      )}
                      {cov.withdrawError && (
                        <div className="alert alert-error" style={{ marginBottom: 12 }}>
                          <span className="alert-icon">⚠️</span>{cov.withdrawError}
                        </div>
                      )}
                      <div className="form-label">Withdraw Amount</div>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
                        <input
                          id="withdraw-amount-input"
                          className="form-input"
                          type="number"
                          value={Number(cov.withdrawAmountMicro) / 1_000_000}
                          min={0.000001}
                          step={0.1}
                          onChange={(e) => {
                            const usdcx = parseFloat(e.target.value) || 0;
                            cov.setWithdrawAmount(String(Math.round(usdcx * 1_000_000)));
                          }}
                          placeholder="1"
                        />
                        <span style={{ fontSize: 14, color: "var(--accent-red)", fontWeight: 600, whiteSpace: "nowrap" }}>USDCx</span>
                        {cov.vaultState && (
                          <button
                            className="btn btn-sm btn-secondary"
                            style={{ whiteSpace: "nowrap" }}
                            onClick={() => cov.setWithdrawAmount(cov.vaultState!.unlocked)}
                          >Max</button>
                        )}
                      </div>
                      <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 12 }}>
                        = {cov.withdrawAmountMicro} micro-units
                      </div>
                      <button
                        id="btn-withdraw"
                        className="btn btn-danger"
                        style={{ width: "100%" }}
                        onClick={cov.withdrawFromVault}
                        disabled={cov.isWithdrawing || !cov.vaultState || cov.vaultState.unlocked === "0"}
                      >
                        {cov.isWithdrawing ? <><div className="spinner" /> Withdrawing...</> : "💸 Withdraw"}
                      </button>
                    </div>
                  </div>

                  {/* Transaction History */}
                  <div className="card">
                    <div className="card-header">
                      <div className="card-title">
                        <div className="card-icon" style={{ background: "rgba(245,158,11,0.15)" }}>📋</div>
                        Audit Trail
                      </div>
                      <div style={{ display: "flex", gap: 8 }}>
                        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>
                          {cov.history.length} events
                        </span>
                        {cov.history.length > 0 && (
                          <button
                            id="btn-clear-history"
                            className="btn btn-danger btn-sm"
                            onClick={cov.clearHistory}
                          >
                            Reset
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="card-body">
                      {/* Recent transactions */}
                      {cov.lastTxs.length > 0 && (
                        <>
                          <div className="form-label">Recent Transactions</div>
                          <div className="tx-list" style={{ marginBottom: 16 }}>
                            {cov.lastTxs.map((tx) => (
                              <div key={tx.txId} className="tx-item">
                                <span className={txTypeBadge(tx.type)}>
                                  {tx.type === "setRoutingRules" ? "Rules" : tx.type}
                                </span>
                                <span className="tx-hash">{tx.txId}</span>
                                <a
                                  href={tx.explorerUrl}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="tx-link"
                                >
                                  Explorer ↗
                                </a>
                              </div>
                            ))}
                          </div>
                        </>
                      )}

                      {/* History log */}
                      <div className="form-label">Behavior History ({cov.history.length} entries)</div>
                      {cov.history.length === 0 ? (
                        <div className="empty-state">
                          <div className="empty-icon">📭</div>
                          <div className="empty-text">No history yet — execute a plan to record the first cycle.</div>
                        </div>
                      ) : (
                        <div className="tx-list">
                          {[...cov.history].reverse().map((entry, i) => (
                            <div key={`${entry.txId}-${i}`} className="tx-item">
                              <span className={txTypeBadge(entry.eventType)}>
                                {entry.eventType === "setRoutingRules" ? "Rules" : entry.eventType}
                              </span>
                              <span className="tx-hash">{entry.txId}</span>
                              <span className="tx-block">blk {entry.blockHeight.toLocaleString()}</span>
                              {entry.wasEarlyWithdraw !== null && (
                                <span style={{ fontSize: 10, color: entry.wasEarlyWithdraw ? "var(--accent-red)" : "var(--accent-green)" }}>
                                  {entry.wasEarlyWithdraw ? "early" : "honored"}
                                </span>
                              )}
                              <a
                                href={`https://explorer.hiro.so/txid/${entry.txId}?chain=testnet`}
                                target="_blank"
                                rel="noreferrer"
                                className="tx-link"
                              >
                                ↗
                              </a>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Footer info */}
          <div style={{ textAlign: "center", marginTop: 40, padding: "20px 0", borderTop: "1px solid var(--border)" }}>
            <p style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.8 }}>
              Covenant uses <code style={{ fontFamily: "JetBrains Mono", color: "var(--accent-purple)" }}>flowvault-sdk@0.1.1</code> on Stacks testnet ·
              History tracked off-chain (localStorage) · Contract stateless between cycles ·{" "}
              <a href="https://github.com" style={{ color: "var(--accent-blue)" }} target="_blank" rel="noreferrer">GitHub</a>
              {" · "}
              <a href="https://explorer.hiro.so" style={{ color: "var(--accent-blue)" }} target="_blank" rel="noreferrer">Hiro Explorer</a>
            </p>
          </div>
        </div>
      </main>
    </>
  );
}
