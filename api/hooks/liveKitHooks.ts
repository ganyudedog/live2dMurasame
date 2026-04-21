import {
  useMutation,
  useQuery,
  type UseMutationOptions,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { error, info, warn } from "../../src/renderer/utils/log";
import { LiveKitApiError } from "../model/liveKitModel";
import type {
  LiveKitHealthResponse,
  LiveKitModelSwitchRequest,
  LiveKitModelSwitchResponse,
  LiveKitModelSwitchResponseServer,
  LiveKitSessionCreatePayload,
  LiveKitSessionCreateResponse,
  LiveKitSessionCreateResponseServer,
  LiveKitTtsCancelRequest,
  LiveKitTtsSpeakRequest,
  LiveKitTtsPreheatRequest,
  LiveKitTtsPreheatPayload,
  LiveKitTtsPreheatResponse,
  LiveKitTtsPreheatResponseServer,
} from "../model/liveKitModel";
import { ensureLiveKitRoomConnected, ensureLiveKitSession } from "../service/liveKitRealtime";
import {
  fromModelSwitchServer,
  fromSessionCreateServer,
  getJson,
  normalizeBaseUrl,
  postRequest,
  toModelSwitchServer,
  toSessionCreateServer,
  toTtsCancelServer,
  toTtsSpeakServer,
  toTtsPreheatServer,
  fromTtsPreheatServer,
} from "../service/liveKitService";

export const useLiveKitHealthQuery = (
  baseUrl: string,
  options?: Omit<
    UseQueryOptions<LiveKitHealthResponse, LiveKitApiError>,
    "queryKey" | "queryFn"
  >,
) => {
  return useQuery<LiveKitHealthResponse, LiveKitApiError>({
    queryKey: ["livekit-v3", "health", normalizeBaseUrl(baseUrl)],
    queryFn: async ({ signal }) => {
      info("livekit.hooks", "health.query.start", {
        baseUrl: normalizeBaseUrl(baseUrl),
      });
      try {
        const data = await getJson<LiveKitHealthResponse>(
          baseUrl,
          "/v3/health",
          signal,
        );
        info("livekit.hooks", "health.query.ok", { ok: data.ok });
        return data;
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        warn("livekit.hooks", "health.query.failed", { err: msg });
        throw e;
      }
    },
    ...options,
  });
};

export const useCreateSessionMutation = (
  baseUrl: string,
  options?: UseMutationOptions<
    LiveKitSessionCreateResponse,
    LiveKitApiError,
    LiveKitSessionCreatePayload | undefined
  >,
) => {
  return useMutation<
    LiveKitSessionCreateResponse,
    LiveKitApiError,
    LiveKitSessionCreatePayload | undefined
  >({
    mutationKey: ["livekit-v3", "session-create", normalizeBaseUrl(baseUrl)],
    mutationFn: async (payload) => {
      const body = toSessionCreateServer(payload);
      info("livekit.hooks", "session.create.start", {
        baseUrl: normalizeBaseUrl(baseUrl),
        client: body.client,
      });
      try {
        const raw = await postRequest<LiveKitSessionCreateResponseServer>(
          baseUrl,
          "/v3/session/create",
          body,
        );
        const data = fromSessionCreateServer(raw);
        info("livekit.hooks", "session.create.ok", {
          sessionId: data.sessionId,
          roomName: data.roomName,
          identity: data.participantIdentity,
        });
        return data;
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        error("livekit.hooks", "session.create.failed", { err: msg });
        throw e;
      }
    },
    ...options,
  });
};

export const useModelSwitchMutation = (
  baseUrl: string,
  options?: UseMutationOptions<
    LiveKitModelSwitchResponse,
    LiveKitApiError,
    LiveKitModelSwitchRequest
  >,
) => {
  return useMutation<
    LiveKitModelSwitchResponse,
    LiveKitApiError,
    LiveKitModelSwitchRequest
  >({
    mutationKey: ["livekit-v3", "model-switch", normalizeBaseUrl(baseUrl)],
    mutationFn: async (request) => {
      const body = toModelSwitchServer(request);
      info("livekit.hooks", "model.switch.start", {
        requestId: request.requestId,
        modelId: request.payload.modelId,
        configVersion: request.payload.configVersion,
      });
      try {
        const raw = await postRequest<LiveKitModelSwitchResponseServer>(
          baseUrl,
          "/v3/model/switch",
          body,
        );
        const data = fromModelSwitchServer(raw);
        info("livekit.hooks", "model.switch.ok", {
          requestId: data.requestId,
          state: data.state,
          modelReady: data.modelReady,
        });
        return data;
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        error("livekit.hooks", "model.switch.failed", {
          requestId: request.requestId,
          err: msg,
        });
        throw e;
      }
    },
    ...options,
  });
};

export const useTtsSpeakMutation = (
  baseUrl: string,
  options?: UseMutationOptions<Blob, LiveKitApiError, LiveKitTtsSpeakRequest>,
) => {
  return useMutation<Blob, LiveKitApiError, LiveKitTtsSpeakRequest>({
    mutationKey: ["livekit-v3", "tts-speak", normalizeBaseUrl(baseUrl)],
    mutationFn: async (request) => {
      const body = toTtsSpeakServer(request);
      info("livekit.hooks", "tts.speak.start", {
        requestId: request.requestId,
        textLen: request.payload.speakText.trim().length,
      });
      try {
        const data = await postRequest<Blob>(
          baseUrl,
          "/v3/tts/speak",
          body,
          undefined,
          "blob",
        );
        info("livekit.hooks", "tts.speak.ok", {
          requestId: request.requestId,
          bytes: data.size,
        });
        return data;
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        error("livekit.hooks", "tts.speak.failed", {
          requestId: request.requestId,
          err: msg,
        });
        throw e;
      }
    },
    ...options,
  });
};

// TTS 预热
export const useTtsPreheatMutation = (
  baseUrl: string,
  options?: UseMutationOptions<
    LiveKitTtsPreheatResponse,
    LiveKitApiError,
    LiveKitTtsPreheatRequest
  >,
) => {
  return useMutation<
    LiveKitTtsPreheatResponse,
    LiveKitApiError,
    LiveKitTtsPreheatRequest
  >({
    mutationKey: ["livekit-v3", "tts-preheat", normalizeBaseUrl(baseUrl)],
    mutationFn: async (request) => {
      const body = toTtsPreheatServer(request);
      info("livekit.hooks", "tts.preheat.start", {
        requestId: request.requestId,
      });
      try {
        const raw = await postRequest<LiveKitTtsPreheatResponseServer>(
          baseUrl,
          "/v3/tts/preheat",
          body,
        );
        const data = fromTtsPreheatServer(raw);
        info("livekit.hooks", "tts.preheat.ok", {
          requestId: data.requestId,
          ok: data.ok,
        });
        return data;
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        error("livekit.hooks", "tts.preheat.failed", {
          requestId: request.requestId,
          err: msg,
        });
        throw e;
      }
    },
    ...options,
  });
};

export type LiveKitConfigPreheatVariables = {
  baseUrl: string;
  requestId: string;
  payload: LiveKitTtsPreheatPayload;
  signal?: AbortSignal;
};

// 配置变更预热：在前端先确保 session/room，再调用后端 preheat 接口。
export const useTtsConfigPreheatMutation = (
  options?: UseMutationOptions<
    LiveKitTtsPreheatResponse,
    LiveKitApiError,
    LiveKitConfigPreheatVariables
  >,
) => {
  return useMutation<
    LiveKitTtsPreheatResponse,
    LiveKitApiError,
    LiveKitConfigPreheatVariables
  >({
    mutationKey: ["livekit-v3", "tts-config-preheat"],
    mutationFn: async (variables) => {
      const normalizedBaseUrl = normalizeBaseUrl(variables.baseUrl);
      info("livekit.hooks", "tts.configPreheat.start", {
        baseUrl: normalizedBaseUrl,
        requestId: variables.requestId,
        textLang: variables.payload.textLang,
      });

      try {
        await ensureLiveKitRoomConnected(normalizedBaseUrl, {
          signal: variables.signal,
          eventTopic: "v3.event",
          reason: "tts-config-preheat",
        });
        const session = await ensureLiveKitSession(
          normalizedBaseUrl,
          {
            client: "desktop",
            version: "0.1.0",
            capabilities: {
              livekit: true,
              audioDownlink: true,
            },
          },
          variables.signal,
        );

        const body = toTtsPreheatServer({
          sessionId: session.sessionId,
          requestId: variables.requestId,
          ts: Date.now(),
          payload: variables.payload,
        } satisfies LiveKitTtsPreheatRequest);

        const raw = await postRequest<LiveKitTtsPreheatResponseServer>(
          normalizedBaseUrl,
          "/v3/tts/preheat",
          body,
          variables.signal,
        );

        const data = fromTtsPreheatServer(raw);
        info("livekit.hooks", "tts.configPreheat.ok", {
          baseUrl: normalizedBaseUrl,
          requestId: data.requestId,
          state: data.state,
          warmed: data.warmed,
        });
        return data;
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        error("livekit.hooks", "tts.configPreheat.failed", {
          baseUrl: normalizedBaseUrl,
          requestId: variables.requestId,
          err: msg,
        });
        throw e;
      }
    },
    ...options,
  });
};

// 取消tts生成语音
export const useTtsCancelMutation = (
  baseUrl: string,
  options?: UseMutationOptions<
    { ok: boolean },
    LiveKitApiError,
    LiveKitTtsCancelRequest
  >,
) => {
  return useMutation<{ ok: boolean }, LiveKitApiError, LiveKitTtsCancelRequest>(
    {
      mutationKey: ["livekit-v3", "tts-cancel", normalizeBaseUrl(baseUrl)],
      mutationFn: async (request) => {
        const body = toTtsCancelServer(request);
        info("livekit.hooks", "tts.cancel.start", {
          requestId: request.requestId,
          reason: request.payload?.reason,
        });
        try {
          const data = await postRequest<{ ok: boolean }>(
            baseUrl,
            "/v3/tts/cancel",
            body,
          );
          info("livekit.hooks", "tts.cancel.ok", {
            requestId: request.requestId,
            ok: data.ok,
          });
          return data;
        } catch (e) {
          const msg = String(e instanceof Error ? e.message : e);
          warn("livekit.hooks", "tts.cancel.failed", {
            requestId: request.requestId,
            err: msg,
          });
          throw e;
        }
      },
      ...options,
    },
  );
};
