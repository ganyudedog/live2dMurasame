export type ControlPanelTabKey = 
  | 'home'
  | 'model-manage'
  | 'model-params'
  | 'model-motions'
  | 'model-interaction'
  | 'ai-settings'
  | 'ai-tts'
  | 'ai-rag'
  | 'ai-rag-params';

export type ThemeMode = 'light' | 'dark';

export type ChatMessageRole = 'user' | 'assistant' | 'system';

export type ChatMessageStatus = 'done' | 'sending' | 'error';

export type ChatMessageSource = 'text' | 'asr' | 'assistant' | 'system';

export type ChatMessage = {
  id: string;
  role: ChatMessageRole;
  text: string;
  status: ChatMessageStatus;
  source: ChatMessageSource;
  createdAt: number;
  requestId?: string;
  error?: string;
};

export type ChatSessionCache = {
  draftText: string;
  messages: ChatMessage[];
  updatedAt: number;
};

export type ModelEntry = {
  id: string;
  name: string;
  path: string;
};

export type GlobalUiSettings = {
  scale: number;
  ignoreMouse: boolean;
  autoLaunch: boolean;
  showDragHandleOnHover: boolean;
  forcedFollow: boolean;
  debugModeEnabled: boolean;
};

export type VisualFrameConfig = {
  ratio: number;
  minPx: number;
  paddingPx: number;
  center: string;
  offsetPx: number;
  offsetRatio: number;
};

export type BubbleConfig = {
  symmetric: boolean;
  headRatio: number | null;
};

export type ModelConfig = {
  touchMap: number[];
  visualFrame: VisualFrameConfig;
  bubble: BubbleConfig;
  interactionZones: Record<string, { heightRange: [number, number]; motions: string[] }>;
  rag: {
    profile: {
      personal: string;
      speakingStyle: string;
      relation: string;
      banned: string;
      world: string;
    };
    retrieval: {
      enabled: boolean;
      topK: number;
      threshold: number;
      knowledgeBasePath: string;
      embeddingModel: string;
      rerankerModel: string;
    };
  };
  tts: {
    enabled: boolean;
    baseUrl: string;
    gptWeightsPath: string;
    sovitsWeightsPath: string;
    textLang: 'zh' | 'ja' | 'en' | 'ko' | 'yue';
    promptLang: 'zh' | 'ja' | 'en' | 'ko' | 'yue';
    refAudioPath: string;
    refAudioText: string;
    textSplitMode: 'cut4' | 'cut50' | 'cut_zh_comma' | 'cut_en_comma' | 'cut_punc' | 'none';
    speedFactor: number;
    fragmentInterval: number;
    useLastGeneratedAsRef: boolean;
    topK: number;
    topP: number;
    temperature: number;
    mediaType: 'wav' | 'ogg' | 'aac';
    streamingMode: boolean;
  };
};
