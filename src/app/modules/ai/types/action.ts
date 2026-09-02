export type ActionKind = 'shake_head' | 'blink' | 'mouth';

export interface ActionIntentInput {
  kind: ActionKind;
  intensity?: number;
  durationMs?: number;
  priority?: number;
  cooldownMs?: number;
  reason?: string;
  requestId?: string;
}

export interface ActionIntentNormalized {
  kind: ActionKind;
  intensity: number;
  durationMs: number;
  priority: number;
  cooldownMs: number;
  reason?: string;
  requestId?: string;
  createdAt: number;
}

export interface ActionCapability {
  canShakeHead: boolean;
  canBlink: boolean;
  canMouth: boolean;
  angleXParamId?: string;
  eyeLParamId?: string;
  eyeRParamId?: string;
  mouthParamId?: string;
}

export interface ActionDispatchResult {
  ok: boolean;
  state: 'started' | 'queued' | 'dropped';
  reason?: 'invalid' | 'cooldown' | 'duplicate' | 'no-capability' | 'low-priority';
}
