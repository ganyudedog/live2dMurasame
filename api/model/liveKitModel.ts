type HttpMethod = 'GET' | 'POST';
type HttpResponseType = 'json' | 'blob' | 'text' | 'arrayBuffer';

export class LiveKitApiError extends Error {
    status: number;

    code?: string;

    details?: unknown;

    constructor(message: string, status: number, code?: string, details?: unknown) {
        super(message);
        this.name = 'LiveKitApiError';
        this.status = status;
        this.code = code;
        this.details = details;
    }
}

export interface LiveKitSessionCreatePayload {
    client?: string;
    version?: string;
    capabilities?: {
        livekit?: boolean;
        audioDownlink?: boolean;
    };
}

export interface LiveKitSessionCreatePayloadServer {
    client: string;
    version: string;
    capabilities: {
        livekit: boolean;
        audio_downlink: boolean;
    };
}

export interface LiveKitSessionCreateResponseServer {
    session_id: string;
    room_name: string;
    participant_identity: string;
    livekit: {
        ws_url: string;
        token: string;
        expires_in: number;
    };
    server_time: number;
}

export interface LiveKitSessionCreateResponse {
    sessionId: string;
    roomName: string;
    participantIdentity: string;
    livekit: {
        wsUrl: string;
        token: string;
        expiresIn: number;
    };
    serverTime: number;
}

export interface LiveKitModelSwitchPayload {
    reason: 'startup' | 'model_switch' | 'settings_update';
    configVersion: string;
    modelId: string;
    gptWeightsPath: string;
    sovitsWeightsPath: string;
    refAudioPath: string;
    promptText: string;
    promptLang: string;
}

export interface LiveKitModelSwitchPayloadServer {
    reason: string;
    config_version: string;
    model_id: string;
    gpt_weights_path: string;
    sovits_weights_path: string;
    ref_audio_path: string;
    prompt_text: string;
    prompt_lang: string;
}

export interface LiveKitModelSwitchRequest {
    sessionId: string;
    requestId: string;
    payload: LiveKitModelSwitchPayload;
}

export interface LiveKitModelSwitchRequestServer {
    session_id: string;
    request_id: string;
    payload: LiveKitModelSwitchPayloadServer;
}

export interface LiveKitModelSwitchResponse {
    ok: boolean;
    requestId: string;
    state: string;
    modelReady: boolean;
}

export interface LiveKitModelSwitchResponseServer {
    ok: boolean;
    request_id: string;
    state: string;
    model_ready: boolean;
}

export interface LiveKitTtsSpeakPayload {
    displayText: string;
    speakText: string;
    textLang: string;
    promptLang: string;
    refAudioPath: string;
    promptText: string;
    textSplitMethod: string;
    speedFactor: number;
    fragmentInterval: number;
    topK: number;
    topP: number;
    temperature: number;
    streamingMode: boolean;
    mediaType: 'wav' | 'ogg' | 'aac' | 'raw';
}

export interface LiveKitTtsSpeakPayloadServer {
    display_text: string;
    speak_text: string;
    text_lang: string;
    prompt_lang: string;
    ref_audio_path: string;
    prompt_text: string;
    text_split_method: string;
    speed_factor: number;
    fragment_interval: number;
    top_k: number;
    top_p: number;
    temperature: number;
    streaming_mode: boolean;
    media_type: 'wav' | 'ogg' | 'aac' | 'raw';
}

export interface LiveKitTtsSpeakRequest {
    sessionId: string;
    requestId: string;
    ts?: number;
    payload: LiveKitTtsSpeakPayload;
}

export interface LiveKitTtsSpeakRequestServer {
    session_id: string;
    request_id: string;
    ts?: number;
    payload: LiveKitTtsSpeakPayloadServer;
}

export interface LiveKitTtsCancelRequest {
    sessionId: string;
    requestId: string;
    ts?: number;
    payload?: {
        reason?: string;
    };
}

export interface LiveKitTtsCancelRequestServer {
    session_id: string;
    request_id: string;
    ts?: number;
    payload: {
        reason?: string;
    };
}

export interface LiveKitHealthResponse {
    ok: boolean;
    message?: string;
}

export interface HttpRequestOptions {
    method: HttpMethod;
    url: string;
    body?: unknown;
    responseType?: HttpResponseType;
    signal?: AbortSignal;
}