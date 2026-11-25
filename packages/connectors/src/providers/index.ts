export * from "./types.js";
export * from "./erp.js";
export * from "./commercial.js";
export * from "./crm.js";
export * from "./ticketing.js";
export * from "./hr.js";
export {
  FINANCE_SOURCE_SYSTEM,
  FINANCE_BASE_URL_ENV,
  FINANCE_API_KEY_ENV,
  financeAuthHeaders,
  financeRecognitionStatus,
  financeProvider,
} from "./finance.js";
export type {
  FinanceFactType,
  FinanceRecognitionStatus,
  FinancePostingEvidence,
} from "./finance.js";
export * from "./pingcode.js";

import type { LocalProvider } from "./types.js";
import { erpProvider } from "./erp.js";
import { commercialProvider } from "./commercial.js";
import { crmProvider } from "./crm.js";
import { createTicketingProvider } from "./ticketing.js";
import { hrProvider } from "./hr.js";
import { financeProvider } from "./finance.js";
import { pingcodeProvider } from "./pingcode.js";

/** 本地系统 provider 注册表；CLI 按 code 选择。 */
const localTicketingProvider = createTicketingProvider({
  projectId: process.env.ANARI_TICKETING_PROJECT_ID ?? "ANARI-TICKETING",
});

export const LOCAL_PROVIDERS: Readonly<Record<string, LocalProvider>> =
  Object.freeze({
    "anari-erp": erpProvider,
    "anari-commercial": commercialProvider,
    "anari-crm": crmProvider,
    "anari-ticketing": localTicketingProvider,
    "anari-hr": hrProvider,
    "anari-finance": financeProvider,
    pingcode: pingcodeProvider,
  });
