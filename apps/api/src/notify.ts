/**
 * Best-effort 通知（NPV2-011 移入共享层）：业务事件触发的站内通知。
 * 失败只打日志，不阻断业务流。
 */
import type { IncentiveStore } from "./store-interface.js";

export async function notifyBestEffort(
  store: IncentiveStore,
  input: {
    recipientPersonId?: string;
    audience: "PERSON" | "MANAGER" | "FINANCE" | "ADMIN";
    title: string;
    body: string;
    sourceType?: string;
    sourceId?: string;
  },
): Promise<void> {
  try {
    await store.createNotification(input);
  } catch (error) {
    console.error("[notification] failed", error);
  }
}
