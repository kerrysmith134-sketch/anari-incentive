/**
 * OpenAI 兼容 LLM 网关（仅用于意图解析与解释性回复）。
 *
 * 治理红线（PRD V4.1 / ai-gate）：
 * - LLM 不产生正式金额、不批准、不结算——/agent-chat 只产出
 *   「命令选择 + 人话回复」，执行一律走 agent 任务状态机；
 * - 评分仍被 assertScoringAllowed 封锁，本模块不接触分数。
 *
 * 支持国产模型的 OpenAI 兼容端点：DeepSeek / GLM(智谱) / Kimi(月之暗面)，
 * 也可用 provider=custom 自定义 base-url。
 */

export type LlmProvider = "deepseek" | "glm" | "kimi" | "custom";

export interface LlmChatConfig {
  provider: LlmProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
  fetchImpl?: typeof fetch;
}

export const LLM_PRESETS: Record<
  Exclude<LlmProvider, "custom">,
  { baseUrl: string; defaultModel: string; label: string }
> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    defaultModel: "deepseek-chat",
    label: "DeepSeek",
  },
  glm: {
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    defaultModel: "glm-4.6",
    label: "GLM 智谱",
  },
  kimi: {
    baseUrl: "https://api.moonshot.cn/v1",
    defaultModel: "kimi-k2",
    label: "Kimi 月之暗面",
  },
};

export function resolveLlmConfigFromEnv(env: NodeJS.ProcessEnv = process.env): LlmChatConfig | undefined {
  const provider = (env.LLM_PROVIDER ?? "") as LlmProvider;
  const apiKey = env.LLM_API_KEY;
  if (!apiKey) return undefined;
  // Empty strings arrive from compose defaults like ${LLM_PROVIDER:-}. A key
  // without a provider cannot pick an endpoint, so the feature stays off
  // instead of crashing the whole API at boot.
  if (!provider) return undefined;
  if (
    provider !== "deepseek" &&
    provider !== "glm" &&
    provider !== "kimi" &&
    provider !== "custom"
  ) {
    throw new Error(
      `LLM_PROVIDER 无效：${provider}（支持 deepseek | glm | kimi | custom）`,
    );
  }
  if (provider === "custom" && !env.LLM_BASE_URL) {
    throw new Error("LLM_PROVIDER=custom 时必须配置 LLM_BASE_URL");
  }
  const preset = provider === "custom" ? undefined : LLM_PRESETS[provider];
  // 空字符串要按“未配置”处理：compose 里 ${VAR:-} 默认给的就是空串，
  // 用 ?? 会让空串盖掉预设值，随后 baseUrl/model 为空直接抛错把 API 拖崩。
  const baseUrl = env.LLM_BASE_URL || preset?.baseUrl;
  const model = env.LLM_MODEL || preset?.defaultModel;
  if (!baseUrl || !model) {
    throw new Error("LLM_BASE_URL / LLM_MODEL 缺失");
  }
  return { provider, baseUrl, apiKey, model };
}

export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmCompletion {
  content: string;
}

export async function llmChatComplete(
  config: LlmChatConfig,
  messages: LlmMessage[],
  options: { temperature?: number; maxTokens?: number; timeoutMs?: number } = {},
): Promise<LlmCompletion> {
  const fetchImpl = config.fetchImpl ?? fetch;
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 30_000,
  );
  try {
    const response = await fetchImpl(`${config.baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature: options.temperature ?? 0.2,
        max_tokens: options.maxTokens ?? 600,
        stream: false,
      }),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `LLM 请求失败：HTTP ${response.status} ${text.slice(0, 200)}`,
      );
    }
    const payload = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = payload.choices?.[0]?.message?.content ?? "";
    if (!content.trim()) throw new Error("LLM 返回为空");
    return { content };
  } finally {
    clearTimeout(timeout);
  }
}

/** 从模型回复中提取严格 JSON（容忍 ```json 围栏与前后缀文本）。 */
export function extractJson(content: string): Record<string, unknown> | null {
  const fenced = content.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1]! : content;
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
