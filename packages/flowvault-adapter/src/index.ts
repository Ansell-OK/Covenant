// flowvault-adapter/src/index.ts
export {
  createCliVault,
  createBrowserVault,
  validateSTXAddress,
  InvalidAddressError,
  InvalidAmountError,
  InvalidRoutingRuleError,
  InvalidConfigurationError,
  ContractCallError,
  NetworkError,
  ParsingError,
} from "./client";

export {
  executeDepositCycle,
  executeWithdraw,
  fetchVaultContext,
} from "./executor";

export type { ExecuteDepositCycleResult } from "./executor";

export {
  getClaimableAmount,
  getSplitterUsdcxBalance,
  buildClaimOptions,
  buildSetRegistryOptions,
  getFullRegistry,
  SPLITTER_CONTRACT_ADDRESS
} from "./splitterClient";
