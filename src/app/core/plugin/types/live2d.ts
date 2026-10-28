export interface Live2dHostApi {
  getAvailableMotions(): readonly string[];
  playMotion(group: string): void;
  interruptMotion(group: string): void;
  getModelState(): { loaded: boolean; status: string };
}
