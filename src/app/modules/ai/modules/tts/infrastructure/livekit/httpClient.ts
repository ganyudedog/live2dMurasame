import { LiveKitApiError, type HttpRequestOptions } from './protocol';

const defaultBaseUrl = "http://127.0.0.1:9881";

export const normalizeBaseUrl = (baseUrl?: string): string => {
  const raw = (baseUrl ?? defaultBaseUrl).trim();
  return raw.replace(/\/+$/, "");
};

const readResponseByType = async (
  response: Response,
  responseType: NonNullable<HttpRequestOptions["responseType"]>,
) => {
  if (responseType === "blob") return response.blob();
  if (responseType === "text") return response.text();
  if (responseType === "arrayBuffer") return response.arrayBuffer();

  const contentType = response.headers.get("content-type") || "";
  if (
    contentType.includes("application/json") ||
    contentType.includes("text/json")
  ) {
    return response.json();
  }

  const rawText = await response.text();
  if (!rawText) return null;

  try {
    return JSON.parse(rawText);
  } catch {
    return rawText;
  }
};

// 使用 fetch 作为统一请求底层，支持 json/blob 与 AbortSignal。
export const requestViaFetch = async <T>({
  method,
  url,
  body,
  responseType = "json",
  signal,
}: HttpRequestOptions): Promise<T> => {
  try {
    const response = await fetch(url, {
      method,
      headers: {
        Accept: "application/json, audio/*;q=0.9, */*;q=0.8",
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const rawResponse = await readResponseByType(response, responseType);

    if (!response.ok) {
      const maybeErr = rawResponse as {
        error?: { code?: string; message?: string };
      } | null;
      const message = maybeErr?.error?.message || `HTTP ${response.status}`;
      const code = maybeErr?.error?.code;
      throw new LiveKitApiError(message, response.status, code, rawResponse);
    }
    return await (rawResponse as T);
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") {
      throw err;
    }

    if (err instanceof LiveKitApiError) {
      throw err;
    }

    throw new LiveKitApiError(
      String(err instanceof Error ? err.message : err),
      0,
    );
  }
};

export const postRequest = async <T>(
  baseUrl: string,
  path: string,
  body: unknown,
  signal?: AbortSignal,
  responseType: NonNullable<HttpRequestOptions["responseType"]> = "json",
): Promise<T> => {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  return requestViaFetch<T>({
    method: "POST",
    url,
    body,
    responseType,
    signal,
  });
};

export const getJson = async <T>(
  baseUrl: string,
  path: string,
  signal?: AbortSignal,
): Promise<T> => {
  const url = `${normalizeBaseUrl(baseUrl)}${path}`;
  return requestViaFetch<T>({
    method: "GET",
    url,
    responseType: "json",
    signal,
  });
};


