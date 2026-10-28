export interface DesktopNotificationsHostApi {
  showNotification(title: string, body?: string): Promise<void>;
}

export interface DesktopWindowHostApi {
  getWindowGeometry(): Promise<{
    bounds: { x: number; y: number; width: number; height: number };
    contentBounds?: { x: number; y: number; width: number; height: number };
    displayId?: number;
    scaleFactor?: number;
  } | null>;
}
