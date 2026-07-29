const PLATFORM_BASE = "/api/platform";
const SESSION_KEY = "la.platform.session.v1";

export class PlatformHttpError extends Error {
  constructor(message, {
    code = "request_failed",
    status = 0,
    details = {},
    requestId = "",
  } = {}) {
    super(message);
    this.name = "PlatformHttpError";
    this.code = code;
    this.status = status;
    this.details = details;
    this.requestId = requestId;
  }
}

export function loadPlatformSession() {
  if (typeof localStorage === "undefined") return null;
  try {
    const session = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
    if (!session?.accessToken || !session?.user) return null;
    if (session.expiresAt && Date.parse(session.expiresAt) <= Date.now()) {
      localStorage.removeItem(SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    localStorage.removeItem(SESSION_KEY);
    return null;
  }
}

export function savePlatformSession(session) {
  if (typeof localStorage === "undefined") return;
  if (!session) {
    localStorage.removeItem(SESSION_KEY);
    return;
  }
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

export function accessToken() {
  return loadPlatformSession()?.accessToken || "";
}

export async function platformRequest(path, options = {}) {
  const token = options.token === undefined ? accessToken() : options.token;
  const response = await fetch(`${PLATFORM_BASE}${path}`, {
    ...options,
    headers: {
      Accept: options.responseType === "blob"
        ? "application/pdf,application/octet-stream"
        : "application/json",
      ...(options.body instanceof FormData
        ? {}
        : options.body
          ? { "Content-Type": "application/json" }
          : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });
  const requestId = response.headers.get("X-Request-ID") || "";
  if (options.responseType === "blob" && response.ok) {
    return {
      blob: await response.blob(),
      filename: parseDownloadFilename(
        response.headers.get("Content-Disposition"),
      ),
      requestId,
    };
  }
  const envelope = await response.json().catch(() => null);
  if (!response.ok || !envelope?.ok) {
    const error = envelope?.error || {};
    if (response.status === 401 && options.clearSessionOnUnauthorized !== false) {
      savePlatformSession(null);
    }
    throw new PlatformHttpError(
      error.message || envelope?.message || `平台请求失败（HTTP ${response.status}）`,
      {
        code: error.code || envelope?.error || "request_failed",
        status: response.status,
        details: error.details || {},
        requestId,
      },
    );
  }
  return envelope.data;
}

export function jsonBody(value) {
  return JSON.stringify(value);
}

function parseDownloadFilename(value) {
  if (!value) return "";
  const encoded = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return encoded[1];
    }
  }
  return value.match(/filename="?([^";]+)"?/i)?.[1] || "";
}
