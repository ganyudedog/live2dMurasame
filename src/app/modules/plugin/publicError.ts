/** Stable public failure codes. Raw provider text never uses this channel. */
export const conversationErrorCodes = [
  'model_not_selected',
  'credentials_missing',
  'character_required',
  'relationship_unavailable',
  'model_switched',
  'generation_failed',
  'executor_incomplete',
  'unavailable',
  'request_rejected',
  'duplicate_request',
  'queue_full',
  'task_failed',
  'timeout',
  'delivery_failed',
] as const;

export type ConversationErrorCode = typeof conversationErrorCodes[number];

const CODE_SET = new Set<string>(conversationErrorCodes);
const DIAGNOSTIC_ID = /^diag_[a-z0-9]{8,32}$/;

export const createDiagnosticId = (): string => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let suffix = '';
  for (let index = 0; index < 12; index += 1) suffix += alphabet[Math.floor(Math.random() * alphabet.length)];
  return `diag_${suffix}`;
};

/** Bounded local detail. Drops URLs, credentials, JSON bodies, and stack frames. */
export const sanitizeLogDetail = (error: unknown): string => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return message
    .replace(/[A-Za-z]:\\[^\s"]+/g, '[path]')
    .replace(/\bsk-[A-Za-z0-9_-]{4,}/g, '[redacted]')
    .replace(/\bBearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/\b(?:api[_-]?key|token)\b\s*[:=]\s*\S+/gi, '[redacted]')
    .replace(/https?:\/\/\S+/gi, '[url]')
    .replace(/\{[\s\S]{24,}\}/g, '[json]')
    .replace(/\bat\s+[^\n]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
};

export const classifyConversationError = (error: unknown): ConversationErrorCode => {
  const message = error instanceof Error ? error.message : String(error ?? '');
  if (CODE_SET.has(message)) return message as ConversationErrorCode;
  if (message.includes('选择对话模型')) return 'model_not_selected';
  if (message.includes('API Key') || message.includes('apiKey')) return 'credentials_missing';
  if (message.includes('选择角色模型')) return 'character_required';
  if (message.includes('模型已切换')) return 'model_switched';
  if (message.includes('without a terminal')) return 'executor_incomplete';
  if (message.includes('disposed')) return 'unavailable';
  return 'generation_failed';
};

export const toPublicError = (
  error: unknown,
  diagnosticId?: string,
): { code: ConversationErrorCode; diagnosticId: string } => {
  const candidate = typeof error === 'string' ? error.trim() : '';
  const code = CODE_SET.has(candidate) ? candidate as ConversationErrorCode : 'generation_failed';
  const id = typeof diagnosticId === 'string' && DIAGNOSTIC_ID.test(diagnosticId) ? diagnosticId : createDiagnosticId();
  return { code, diagnosticId: id };
};
