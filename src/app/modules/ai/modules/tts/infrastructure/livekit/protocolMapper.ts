import {
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
} from "./protocol";

export const toSessionCreateServer = (
  payload?: LiveKitSessionCreatePayload,
): LiveKitSessionCreatePayloadServer => {
  return {
    client: payload?.client?.trim() || "desktop",
    version: payload?.version?.trim() || "0.1.0",
    capabilities: {
      livekit: payload?.capabilities?.livekit !== false,
      audio_downlink: payload?.capabilities?.audioDownlink !== false,
      transport_mode: payload?.capabilities?.transportMode === 'loopback' ? 'loopback' : 'network',
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
    transportMode: raw.transport_mode === 'loopback' ? 'loopback' : 'network',
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
      trace_id: request.payload.traceId,
      queue_group_id: request.payload.queueGroupId,
      sentence_index: request.payload.sentenceIndex,
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

