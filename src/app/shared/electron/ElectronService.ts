import { ElectronBridgeService } from './services/ElectronBridgeService';
import { ElectronDragService } from './services/ElectronDragService';

/** Root Electron capability registered in DI; child services are private to this ownership tree. */
export class ElectronService {
  readonly bridge: ElectronBridgeService;
  readonly drag: ElectronDragService;

  constructor() {
    this.bridge = new ElectronBridgeService();
    this.drag = new ElectronDragService(this.bridge);
  }

  start(): void {
    this.drag.start();
  }

  dispose(): void {
    this.drag.dispose();
  }
}
