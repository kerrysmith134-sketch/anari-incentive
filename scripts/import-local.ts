/**
 * 从本地 Anari 系统拉取数据并写入 N-Perform。
 *
 * 用法：
 *   N_PERFORM_BASE_URL=http://127.0.0.1:4000 N_PERFORM_TOKEN=... \
 *   ANARI_ERP_BASE_URL=http://127.0.0.1:8000 ANARI_ERP_TOKEN=... \
 *   npx tsx scripts/import-local.ts --provider anari-erp [--dry-run]
 *
 * provider 的实现只负责真实 endpoint + 字段映射；这个脚本负责鉴权、分页、
 * 去重、HTTP 错误汇总。默认不写库，必须显式去掉 --dry-run。
 */
import { LOCAL_PROVIDERS, type LocalProvider, type PullTarget } from "../packages/connectors/src/providers/index.js";

interface Args {
  provider: string;
  dryRun: boolean;
  maxPages: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { provider: "", dryRun: false, maxPages: 100 };
  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === "--provider") args.provider = argv[++i] ?? "";
    else if (value === "--dry-run") args.dryRun = true;
    else if (value === "--max-pages") args.maxPages = Number(argv[++i] ?? 100);
    else if (value === "--help" || value === "-h") {
      console.log(
        "usage: import-local.ts --provider <code> [--dry-run] [--max-pages N]\n" +
          `providers: ${Object.keys(LOCAL_PROVIDERS).join(", ")}`,
      );
      process.exit(0);
    }
  }
  if (!args.provider) throw new Error("--provider is required");
  if (!Number.isInteger(args.maxPages) || args.maxPages <= 0) {
    throw new Error("--max-pages must be a positive integer");
  }
  return args;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`missing env ${name}`);
  return value.replace(/\/+$/, "");
}

function authHeaders(provider: LocalProvider): Record<string, string> {
  const token = requireEnv(provider.tokenEnv);
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
  };
}

function nextCursor(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const root = body as Record<string, unknown>;
  const meta = root.meta;
  if (meta && typeof meta === "object") {
    const metaRecord = meta as Record<string, unknown>;
    const pagination = metaRecord.pagination;
    if (pagination && typeof pagination === "object") {
      const value = (pagination as Record<string, unknown>).next_cursor;
      if (typeof value === "string" && value) return value;
    }
    const value = metaRecord.next_cursor;
    if (typeof value === "string" && value) return value;
  }
  const value = root.next_cursor;
  return typeof value === "string" && value ? value : undefined;
}

async function postWrite(
  baseUrl: string,
  token: string | undefined,
  path: string,
  body: Record<string, unknown>,
  dryRun: boolean,
): Promise<void> {
  if (dryRun) return;
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `POST ${path} -> ${response.status} ${text.slice(0, 500)}`,
    );
  }
}

async function pullTarget(input: {
  provider: LocalProvider;
  baseUrl: string;
  target: PullTarget;
  nPerformBaseUrl: string;
  nPerformToken: string | undefined;
  dryRun: boolean;
  maxPages: number;
}): Promise<{ fetched: number; written: number; skipped: number; errors: string[] }> {
  const { provider, baseUrl, target } = input;
  const headers = authHeaders(provider);
  let cursor: string | undefined;
  let page =
    target.pageParam &&
    !target.pageParam.includes("offset") &&
    !target.pageParam.includes("skip") &&
    !target.pageParam.includes("index")
      ? 1
      : 0;
  let fetched = 0;
  let written = 0;
  let skipped = 0;
  const errors: string[] = [];
  const seen = new Set<string>();

  for (let pageIndex = 0; pageIndex < input.maxPages; pageIndex += 1) {
    const url = new URL(`${baseUrl}${target.path}`);
    for (const [key, value] of Object.entries(target.query ?? {})) {
      url.searchParams.set(key, value);
    }
    if (target.limitParam) {
      url.searchParams.set(target.limitParam, String(target.pageSize ?? 50));
    }
    if (cursor && target.cursorParam) url.searchParams.set(target.cursorParam, cursor);
    else if (target.pageParam) url.searchParams.set(target.pageParam, String(page));

    const response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      const text = await response.text().catch(() => "");
      throw new Error(
        `GET ${url.pathname} -> ${response.status} ${text.slice(0, 300)}`,
      );
    }
    const body = (await response.json()) as unknown;
    const records = target.extract(body);
    fetched += records.length;
    for (const record of records) {
      const normalized = target.normalize(record);
      const writes = Array.isArray(normalized) ? normalized : [normalized];
      for (const write of writes) {
        if (!write || !write.path || !write.externalId) continue;
        const key = `${write.path}\u001f${write.externalId}`;
        if (seen.has(key)) {
          skipped += 1;
          continue;
        }
        seen.add(key);
        try {
          await postWrite(
            input.nPerformBaseUrl,
            input.nPerformToken,
            write.path,
            write.body,
            input.dryRun,
          );
          written += 1;
        } catch (error) {
          errors.push(
            `${write.path} ${write.externalId}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
    }

    if (target.cursorParam) {
      cursor = nextCursor(body);
      if (!cursor) break;
    } else {
      const pageSize = target.pageSize ?? 50;
      if (records.length < pageSize) break;
      page += 1;
    }
  }
  return { fetched, written, skipped, errors };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const provider = LOCAL_PROVIDERS[args.provider];
  if (!provider) {
    throw new Error(
      `unknown provider ${args.provider}; known: ${Object.keys(LOCAL_PROVIDERS).join(", ")}`,
    );
  }
  const baseUrl = requireEnv(provider.baseUrlEnv);
  const nPerformBaseUrl = requireEnv("N_PERFORM_BASE_URL");
  const nPerformToken = process.env.N_PERFORM_TOKEN;

  let total = 0;
  const allErrors: string[] = [];
  for (const target of provider.targets) {
    const result = await pullTarget({
      provider,
      baseUrl,
      target,
      nPerformBaseUrl,
      nPerformToken,
      dryRun: args.dryRun,
      maxPages: args.maxPages,
    });
    total += result.fetched;
    allErrors.push(...result.errors);
    console.log(
      `[${provider.code}] ${target.path}: fetched=${result.fetched} written=${result.written} skipped=${result.skipped}`,
    );
  }
  if (allErrors.length > 0) {
    console.error(`errors=${allErrors.length}`);
    for (const error of allErrors.slice(0, 20)) console.error(`- ${error}`);
    process.exitCode = 1;
  } else {
    console.log(`${args.dryRun ? "DRY RUN" : "DONE"} provider=${provider.code} records=${total}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
