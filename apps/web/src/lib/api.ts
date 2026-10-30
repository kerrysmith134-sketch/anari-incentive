export interface Session {
  tenantId: string;
  userId: string;
  personId: string;
  /** Optional OIDC bearer token for deployments using AUTH_MODE=oidc. */
  token?: string;
}

const SESSION_KEY = "anari.session";

export const DEFAULT_SESSION: Session = {
  tenantId: import.meta.env.VITE_TENANT_ID ?? "tenant-demo",
  userId: import.meta.env.VITE_USER_ID ?? "dev-user",
  personId:
    import.meta.env.VITE_PERSON_ID ??
    "00000000-0000-4000-8000-000000000001",
  token: "",
};

export function loadSession(): Session {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return DEFAULT_SESSION;
    const parsed = JSON.parse(raw) as Partial<Session>;
    return {
      tenantId: parsed.tenantId || DEFAULT_SESSION.tenantId,
      userId: parsed.userId || DEFAULT_SESSION.userId,
      personId: parsed.personId || DEFAULT_SESSION.personId,
      token: parsed.token || "",
    };
  } catch {
    return DEFAULT_SESSION;
  }
}

export function saveSession(session: Session): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
  } catch {
    /* localStorage may be unavailable */
  }
}

let session: Session = loadSession();

export function setApiSession(next: Session): void {
  session = next;
}

export function getApiSession(): Session {
  return session;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;

  constructor(
    status: number,
    code: string,
    message: string,
    details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

interface ApiEnvelope<T> {
  data: T;
  meta?: { correlation_id?: string };
}

function headers(extra?: HeadersInit): Headers {
  const result = new Headers(extra);
  result.set("accept", "application/json");
  result.set("x-tenant-id", session.tenantId);
  result.set("x-user-id", session.userId);
  result.set("x-person-id", session.personId);
  if (session.token) result.set("authorization", `Bearer ${session.token}`);
  return result;
}

export async function api<T>(
  path: string,
  options: {
    method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
    body?: unknown;
    signal?: AbortSignal;
  } = {},
): Promise<T> {
  const response = await fetch(path, {
    method: options.method ?? "GET",
    headers: headers(
      options.body === undefined
        ? undefined
        : { "content-type": "application/json" },
    ),
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: options.signal,
  });
  const text = await response.text();
  let payload: unknown = undefined;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = undefined;
    }
  }
  if (!response.ok) {
    const error = (payload as {
      error?: { code?: string; message?: string; details?: unknown };
    })?.error;
    throw new ApiError(
      response.status,
      error?.code ?? `HTTP_${response.status}`,
      error?.message ??
        (text.length > 0 && text.length < 300 ? text : response.statusText) ??
        "Request failed",
      error?.details,
    );
  }
  if (payload && typeof payload === "object" && "data" in payload) {
    return (payload as ApiEnvelope<T>).data;
  }
  return payload as T;
}

export async function downloadFile(
  path: string,
  filename: string,
): Promise<void> {
  const response = await fetch(path, { headers: headers() });
  if (!response.ok) {
    throw new ApiError(
      response.status,
      `HTTP_${response.status}`,
      `Download failed (${response.status})`,
    );
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

/** Build a query string, omitting empty values. */
export function qs(
  params: Record<string, string | number | undefined | null>,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
