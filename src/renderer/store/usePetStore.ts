import { create } from 'zustand';
import type { Live2DModel } from '../components/pet/live2dManage/runtime';
import { MotionManager } from '../components/pet/live2dManage/motionManager';
import { sharedStoreClient } from '../shared/sharedStoreClient';
import type { PatchOp } from '../shared/sharedStateTypes';

type ModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface PetStoreState {
	scale: number;
	ignoreMouse: boolean;
	showDragHandleOnHover: boolean;
	model: Live2DModel | null;
	modelLoadStatus: ModelLoadStatus;
	modelLoadError?: string;
	availableMotions: string[];
	playingMotion: string | null;
	playingMotionText: string | null;
	playingMotionSound: string | null;
	settingsLoaded: boolean;  // 延迟模型加载，先加载设置
	motionManager: MotionManager;
	debugModeEnabled?: boolean; // 调试模式是否开启
	loadSettings: () => (()=>void) | undefined;
	connectSharedWorkerScale: () => () => void;
	setScale: (value: number) => void;
	setIgnoreMouse: (value: boolean) => void;
	setShowDragHandleOnHover: (value: boolean) => void;
	setModel: (model: Live2DModel | null) => void;
	clearModel: () => void;
	setModelLoadStatus: (status: ModelLoadStatus, error?: string) => void;
	refreshMotions: () => string[];
	playMotion: (group: string) => void;
	interruptMotion: (group: string) => void;
	setMotionText: (text: string | null) => void;
	setDebugModeEnabled: (value: boolean) => void;
}

export const DEFAULT_SCALE = 1;
export const MIN_SCALE = 0.3;
export const MAX_SCALE = 2;
export const DEFAULT_SHOW_DRAG_HANDLE_ON_HOVER = true;

const getPetApi = () => {
	if (typeof window === 'undefined') return undefined;
	return window.petAPI;
};

export function clampScale(value: number) {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export const usePetStore = create<PetStoreState>((set) => {
	const motionManager = new MotionManager({ idleMinMs: 20000, idleMaxMs: 40000 });
	let sharedOff: (() => void) | null = null;

	const attachModelToManager = (model: Live2DModel | null) => {
		motionManager.dispose();
		if (model) {
			motionManager.attach(model);
		}
		return motionManager.getGroups();
	};

	return {
		scale: DEFAULT_SCALE,
		ignoreMouse: false,
		showDragHandleOnHover: DEFAULT_SHOW_DRAG_HANDLE_ON_HOVER,
		settingsLoaded: false,  // 延迟模型加载，先加载设置
		model: null,
		modelLoadStatus: 'idle',
		modelLoadError: undefined,
		availableMotions: [],
		playingMotion: null,
		playingMotionText: null,
		playingMotionSound: null,
		motionManager,
		debugModeEnabled: false,

		loadSettings: () => {
			const next: Partial<PetStoreState> = {};
			set({ ...next });

			// Load settings from Electron main process
			const api = getPetApi();
			if (api?.getLive2denvGlobal) {
				api.getLive2denvGlobal().then(remote => {
					if (!remote || typeof remote !== 'object') return;
					const patch: Partial<PetStoreState> = {};

					if (typeof remote.scale === 'number') {
						const clampedScale = clampScale(remote.scale);
						patch.scale = clampedScale;
						// 阶段 1：优先把初始 scale 推给 SharedWorker，让控制面板与模型窗口立刻一致。
						sharedStoreClient.dispatchPatch([{ path: 'global.scale', value: clampedScale }]);
					}
					if (typeof remote.ignoreMouse === 'boolean') {
						patch.ignoreMouse = remote.ignoreMouse;
					}
					if (typeof remote.showDragHandleOnHover === 'boolean') {
						patch.showDragHandleOnHover = remote.showDragHandleOnHover;
					}
					if (typeof remote.debugModeEnabled === 'boolean') {
						patch.debugModeEnabled = remote.debugModeEnabled;
					}
					if (Object.keys(patch).length) {
						set(patch);
					}
				}).catch(error => {
					console.warn('[PetStore] load remote settings failed', error);
				})
				.finally(() => {
					set({ settingsLoaded: true });
				});
			}
			let off: (()=>void) | undefined;
			if (api?.onLive2denvGlobalUpdated) {
				off = api.onLive2denvGlobalUpdated((newSettings) => {
					set({ ...newSettings });
				}) as (() => void) | undefined;
			}
			return off;
		},

		connectSharedWorkerScale: () => {
			if (sharedOff) return sharedOff;
			// 订阅 worker 的 patched/state，用于实时更新模型窗口 scale。
			sharedOff = sharedStoreClient.subscribe((msg) => {
				if (msg.type === 'state') {
					const next = clampScale(msg.state.global.scale);
					set({ scale: next });
					return;
				}
				if (msg.type === 'patched') {
					let nextScale: number | null = null;
					msg.ops.forEach((op: PatchOp) => {
						if (op.path === 'global.scale') nextScale = op.value;
					});
					if (nextScale == null) return;
					set({ scale: clampScale(nextScale) });
				}
			});
			// 触发一次初始 state 拉取（hello 之后会收到 state）
			sharedStoreClient.getInitialState().then((initial) => {
				if (!initial) return;
				set({ scale: clampScale(initial.global.scale) });
			});
			return () => {
				sharedOff?.();
				sharedOff = null;
			};
		},

		setScale: (value) => {
			const clamped = clampScale(Number.isFinite(value) ? value : DEFAULT_SCALE);
			set({ scale: clamped });
			// 阶段 1：scale 的实时联动只走 SharedWorker（patch 广播）。
			// 持久化/写盘将在后续阶段接入。
			sharedStoreClient.dispatchPatch([{ path: 'global.scale', value: clamped }]);
		},

		setIgnoreMouse: (value) => {
			set({ ignoreMouse: value });
			const api = getPetApi();
			console.log('[PetStore] update ignoreMouse', value);
			api?.updateLive2denvGlobal?.({ ignoreMouse: value }).catch((error: unknown) => {
				console.warn('[PetStore] update settings failed', error);
			});
		},

		setShowDragHandleOnHover: (value) => {
			set({ showDragHandleOnHover: value });
			const api = getPetApi();
			api?.updateLive2denvGlobal?.({ showDragHandleOnHover: value }).catch((error: unknown) => {
				console.warn('[PetStore] update settings failed', error);
			});
		},


		setDebugModeEnabled(value) {
			set({ debugModeEnabled: value });
			const api = getPetApi();
			api?.updateLive2denvGlobal?.({ debugModeEnabled: value }).catch((error: unknown) => {
				console.warn('[PetStore] sync debugModeEnabled failed', error);
			});
		},

		setModel: (model) => {
			const groups = attachModelToManager(model);
			set({ model, availableMotions: groups, playingMotion: null, playingMotionText: null, playingMotionSound: null });
		},

		clearModel: () => {
			attachModelToManager(null);
			set({ model: null, availableMotions: [], playingMotion: null, playingMotionText: null, playingMotionSound: null });
		},

		setModelLoadStatus: (status, error) => {
			set({ modelLoadStatus: status, modelLoadError: error });
		},

		refreshMotions: () => {
			const groups = motionManager.getGroups();
			set({ availableMotions: groups });
			return groups;
		},

		playMotion: (group) => {
			if (!group) return;
			const meta = motionManager.play(group);
			set({ playingMotion: group, playingMotionText: meta?.text ?? null, playingMotionSound: meta?.sound ?? null });
		},

		interruptMotion: (group) => {
			if (!group) return;
			const meta = motionManager.interruptAndPlay(group);
			set({ playingMotion: group, playingMotionText: meta?.text ?? null, playingMotionSound: meta?.sound ?? null });
		},

		setMotionText: (text) => {
			if (text === null) {
				set({ playingMotionText: null, playingMotionSound: null });
				return;
			}
			set({ playingMotionText: text });
		},
	};
});

export type { ModelLoadStatus };
