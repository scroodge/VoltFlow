type ApiRequestOptions = Omit<RequestInit, "body" | "method"> & {
  body?: unknown;
};

const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL;

export class ApiError extends Error {
  public readonly status: number;
  public readonly statusText: string;
  public readonly url: string;

  constructor(
    message: string,
    status: number,
    statusText: string,
    url: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.statusText = statusText;
    this.url = url;
  }
}

export async function apiGet<TResponse>(
  path: string,
  options: ApiRequestOptions = {},
) {
  return apiRequest<TResponse>(path, { ...options, method: "GET" });
}

export async function apiPost<TResponse>(
  path: string,
  body?: unknown,
  options: ApiRequestOptions = {},
) {
  return apiRequest<TResponse>(path, { ...options, body, method: "POST" });
}

async function apiRequest<TResponse>(
  path: string,
  options: ApiRequestOptions & { method: "GET" | "POST" },
) {
  const { body, ...requestOptions } = options;
  const url = buildApiUrl(path);
  const headers = new Headers(options.headers);
  const init: RequestInit = {
    ...requestOptions,
    headers,
  };

  if (body !== undefined) {
    headers.set("Content-Type", headers.get("Content-Type") ?? "application/json");
    init.body = JSON.stringify(body);
  }

  const response = await fetch(url, init);

  if (!response.ok) {
    throw await createApiError(response, url);
  }

  if (response.status === 204) {
    return undefined as TResponse;
  }

  return response.json() as Promise<TResponse>;
}

function buildApiUrl(path: string) {
  if (!apiBaseUrl) {
    throw new Error("NEXT_PUBLIC_API_URL is not configured.");
  }

  return new URL(path, apiBaseUrl).toString();
}

async function createApiError(response: Response, url: string) {
  const details = await readErrorDetails(response);
  const suffix = details ? `: ${details}` : "";

  return new ApiError(
    `API request failed with ${response.status} ${response.statusText}${suffix}`,
    response.status,
    response.statusText,
    url,
  );
}

async function readErrorDetails(response: Response) {
  const contentType = response.headers.get("Content-Type") ?? "";

  try {
    if (contentType.includes("application/json")) {
      const payload = await response.json();

      if (payload && typeof payload === "object") {
        if ("message" in payload && typeof payload.message === "string") {
          return payload.message;
        }

        if ("error" in payload && typeof payload.error === "string") {
          return payload.error;
        }
      }

      return JSON.stringify(payload);
    }

    return await response.text();
  } catch {
    return "";
  }
}
