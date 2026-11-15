import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, api } from "../lib/api.js";

export interface QueryState<T> {
  data: T | undefined;
  error: ApiError | Error | undefined;
  loading: boolean;
  reload: () => void;
  setData: (next: T | undefined) => void;
}

/**
 * Fetch a GET endpoint with abort-on-unmount semantics and a manual reload.
 * `key` identifies the query; changing it refetches.
 */
export function useApiQuery<T>(
  path: string | null,
  key?: string | number | null,
): QueryState<T> {
  const [data, setData] = useState<T | undefined>(undefined);
  const [error, setError] = useState<ApiError | Error | undefined>(undefined);
  const [loading, setLoading] = useState(Boolean(path));
  const [nonce, setNonce] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!path) {
      setData(undefined);
      setLoading(false);
      setError(undefined);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(undefined);
    api<T>(path, { signal: controller.signal })
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((caught: unknown) => {
        if (controller.signal.aborted) return;
        if (caught instanceof DOMException && caught.name === "AbortError") {
          return;
        }
        setError(caught instanceof Error ? caught : new Error(String(caught)));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, key, nonce]);

  const reload = useCallback(() => setNonce((value) => value + 1), []);

  return { data, error, loading, reload, setData };
}

export function useDocumentTitle(title: string): void {
  useEffect(() => {
    document.title = title ? `${title} · N-Perform` : "N-Perform Console";
  }, [title]);
}


/**
 * AUD-017：当前租户扩展模块 capability。
 * 加载失败按未启用处理（fail-closed，与后端 FEATURE_DISABLED 一致）。
 */
export function useTenantModules(): {
  modules: Set<string>;
  loading: boolean;
  error?: Error;
  reload: () => void;
} {
  const query = useApiQuery<{ modules: string[] }>(
    "/api/v1/tenant-modules",
    "tenant-modules",
  );
  const modules = new Set(query.data?.modules ?? []);
  return {
    modules,
    loading: query.loading,
    error: query.error instanceof Error ? query.error : undefined,
    reload: query.reload,
  };
}
