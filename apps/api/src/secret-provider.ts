/**
 * INT-201（Sprint 2.1）：SecretProvider——统一的凭据解析入口。
 *
 * 支持两种配置面（可并存，SECRETS_JSON 优先）：
 * - SECRETS_JSON：内联 JSON（开发/演示）
 * - SECRETS_FILE：JSON 文件路径（生产挂载 Secret 卷后指向它；
 *   生产 Vault/KMS 通过 sidecar 渲染该文件，worker 不直接依赖厂商 SDK）
 *
 * API 侧用于 testConnection 探测注入；runner 侧用于同步凭据链
 * （credentialRef → 真实凭据 → connector 认证头）。
 */
import { readFileSync } from "node:fs";

export function resolveSecret(credentialRef: string): string | undefined {
  const inline = process.env.SECRETS_JSON;
  if (inline) {
    try {
      const map = JSON.parse(inline) as Record<string, string>;
      if (typeof map[credentialRef] === "string") return map[credentialRef];
    } catch {
      /* 配置错误按缺失处理 */
    }
  }
  const filePath = process.env.SECRETS_FILE;
  if (filePath) {
    try {
      const map = JSON.parse(readFileSync(filePath, "utf8")) as Record<string, string>;
      if (typeof map[credentialRef] === "string") return map[credentialRef];
    } catch {
      /* 文件缺失/损坏按缺失处理 */
    }
  }
  return undefined;
}
