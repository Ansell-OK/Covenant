Name / Team Name: <your name>
Email Address: <email>
Telegram / X Username: <handle>
Stacks Wallet Address: <ST... testnet address used for the on-chain proof tx>

Project Name: Covenant
One-Line Description: A behavior-adaptive routing engine for FlowVault — vesting, savings, and
treasury rules that tighten or loosen automatically based on on-chain history, compiled from
plain-English policy and reusable across payroll, savings, treasury, and creator-revenue use cases.

Project Category: Payroll & Compensation, Goal-Based Savings, Treasury Automation,
Creator Revenue Flows, Experimental Financial Behaviors
(all five apply — Covenant is one engine, config-selectable across all of them; explain this
explicitly to the judges rather than picking one, since it's the core of the Ecosystem Value pitch)

What problem does your project solve?
FlowVault's routing rules are static: one lock, one split, set once, unchanged until a human
reconfigures them. Every real use of programmable money — contributor vesting, savings
discipline, treasury reserves, revenue splits — actually needs rules that respond to behavior:
reward reliability, tighten after risky activity, adapt to changing conditions. FlowVault's
contract intentionally has no concept of history, so nothing built directly on it can do this.
Covenant is the missing layer: it watches on-chain behavior over time and re-issues FlowVault
routing rules accordingly, turning a static primitive into an adaptive one, without changing or
redeploying the contract.

How does your project use FlowVault?
Explain which primitives are used: Combination — Lock, Split, and Hold are all used, and which
one is active (and how strict) changes over time based on a principal's own history. A plain-
English policy is compiled (via an optional, swappable, free-tier LLM layer with a zero-cost
deterministic fallback) into a structured PolicySpec. A separate, LLM-independent engine reads
on-chain state via getVaultState/getRoutingRules/getCurrentBlockHeight, derives behavior signals
(early-withdraw streaks, honored-lock streaks, deposit cadence, outflow velocity), and computes
the next lock/split/hold configuration, which is applied via setRoutingRules. This repeats every
cycle, so the same deposit address can move from a strict lock to a looser one (or vice versa)
purely as a function of its own on-chain behavior — a financial behavior FlowVault's static
contract cannot express on its own.

GitHub Repository: <link>
Live Demo URL: <link>
Demo Video (YouTube/Loom): <link>
Presentation / Documentation Link: <README link, Ecosystem Value section specifically>

On-Chain Proof:
Provide at least one successful transaction demonstrating FlowVault integration
<testnet tx id + explorer link from section 12's verification gate — include at least two, ideally
showing the SAME address's routing rules changing between cycles, since that's the actual proof
of the adaptive behavior, not just "a deposit happened">

If given additional funding, how would you continue building this project?
Publish covenant-core and policy-compiler as standalone npm packages with a stable API so other
FlowVault builders can add behavior-adaptive routing to their own apps without adopting our UI.
Add more BehaviorSignals (counterparty reliability across shared vaults, multi-principal DAO
policies), a hosted trigger-checking service (so re-planning doesn't depend on a browser tab
being open), and a policy marketplace where teams can share/fork PolicySpec templates for common
use cases (contributor vesting, DAO reserves, creator splits).
