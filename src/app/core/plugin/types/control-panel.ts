export interface ControlPanelHostApi {
  getActiveTab(): string;
  openTab(tabId: string): void;
}
