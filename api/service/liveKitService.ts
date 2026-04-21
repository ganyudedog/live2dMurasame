import {
  LiveKitApiError,
  type HttpRequestOptions,
  type LiveKitModelSwitchRequest,
  type LiveKitModelSwitchRequestServer,
  type LiveKitModelSwitchResponse,
  type LiveKitModelSwitchResponseServer,
  type LiveKitSessionCreatePayload,
  type LiveKitSessionCreatePayloadServer,
  type LiveKitSessionCreateResponse,
  type LiveKitSessionCreateResponseServer,
  type LiveKitTtsCancelRequest,
  type LiveKitTtsCancelRequestServer,
  type LiveKitTtsPreheatRequest,
  type LiveKitTtsPreheatRequestServer,
  type LiveKitTtsPreheatResponse,
  type LiveKitTtsPreheatResponseServer,
  type LiveKitTtsSpeakRequest,
  type LiveKitTtsSpeakRequestServer,
} from "../model/liveKitModel";

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

export const toSessionCreateServer = (
  payload?: LiveKitSessionCreatePayload,
): LiveKitSessionCreatePayloadServer => {
  return {
    client: payload?.client?.trim() || "desktop",
    version: payload?.version?.trim() || "0.1.0",
    capabilities: {
      livekit: payload?.capabilities?.livekit !== false,
      audio_downlink: payload?.capabilities?.audioDownlink !== false,
    },
  };
};

export const fromSessionCreateServer = (
  raw: LiveKitSessionCreateResponseServer,
): LiveKitSessionCreateResponse => {
  return {
    sessionId: raw.session_id,
    roomName: raw.room_name,
    participantIdentity: raw.participant_identity,
    livekit: {
      wsUrl: raw.livekit.ws_url,
      token: raw.livekit.token,
      expiresIn: raw.livekit.expires_in,
    },
    serverTime: raw.server_time,
  };
};

export const toModelSwitchServer = (
  request: LiveKitModelSwitchRequest,
): LiveKitModelSwitchRequestServer => {
  return {
    session_id: request.sessionId,
    request_id: request.requestId,
    payload: {
      reason: request.payload.reason,
      config_version: request.payload.configVersion,
      model_id: request.payload.modelId,
      gpt_weights_path: request.payload.gptWeightsPath,
      sovits_weights_path: request.payload.sovitsWeightsPath,
      ref_audio_path: request.payload.refAudioPath,
      prompt_text: request.payload.promptText,
      prompt_lang: request.payload.promptLang,
    },
  };
};

export const fromModelSwitchServer = (
  raw: LiveKitModelSwitchResponseServer,
): LiveKitModelSwitchResponse => {
  return {
    ok: raw.ok,
    requestId: raw.request_id,
    state: raw.state,
    modelReady: raw.model_ready,
  };
};

export const toTtsSpeakServer = (
  request: LiveKitTtsSpeakRequest,
): LiveKitTtsSpeakRequestServer => {
  return {
    session_id: request.sessionId,
    request_id: request.requestId,
    ts: request.ts,
    payload: {
      display_text: request.payload.displayText,
      speak_text: request.payload.speakText,
      text_lang: request.payload.textLang,
      prompt_lang: request.payload.promptLang,
      ref_audio_path: request.payload.refAudioPath,
      prompt_text: request.payload.promptText,
      text_split_method: request.payload.textSplitMethod,
      speed_factor: request.payload.speedFactor,
      fragment_interval: request.payload.fragmentInterval,
      top_k: request.payload.topK,
      top_p: request.payload.topP,
      temperature: request.payload.temperature,
      streaming_mode: request.payload.streamingMode,
      media_type: request.payload.mediaType,
    },
  };
};

export const toTtsCancelServer = (
  request: LiveKitTtsCancelRequest,
): LiveKitTtsCancelRequestServer => {
  return {
    session_id: request.sessionId,
    request_id: request.requestId,
    ts: request.ts,
    payload: {
      reason: request.payload?.reason,
    },
  };
};

// 构建预热请求的服务器结构，和构建语音合成请求类似，但参数更少一些。
export const toTtsPreheatServer = (
  request: LiveKitTtsPreheatRequest,
): LiveKitTtsPreheatRequestServer => {
  return {
    session_id: request.sessionId,
    request_id: request.requestId,
    ts: request.ts,
    payload: {
      text_lang: request.payload.textLang,
      prompt_lang: request.payload.promptLang,
      ref_audio_path: request.payload.refAudioPath,
      prompt_text: request.payload.promptText,
    },
  };
};

export const fromTtsPreheatServer = (
  raw: LiveKitTtsPreheatResponseServer,
): LiveKitTtsPreheatResponse => {
  return {
    ok: raw.ok,
    requestId: raw.request_id,
    state: raw.state || (raw.ok ? "tts.preheat.finished" : "tts.preheat.failed"),
    warmed: raw.warmed ?? Boolean(raw.ok),
  };
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
