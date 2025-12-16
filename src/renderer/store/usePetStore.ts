import { create } from 'zustand';
import type { Live2DModel } from '../live2dManage/runtime';
import { MotionManager } from '../live2dManage/motionManager';

type ModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface PersistedSettings {
	scale: number;
	ignoreMouse: boolean;
	showDragHandleOnHover: boolean;
	autoLaunchEnabled: boolean;
	forcedFollow: boolean;
}

interface PetStoreState {
	scale: number;
	ignoreMouse: boolean;
	showDragHandleOnHover: boolean;
	autoLaunchEnabled: boolean;
	forcedFollow: boolean;
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
	setScale: (value: number) => void;
	nudgeScale: (delta: number) => void;
	resetScale: () => void;
	setIgnoreMouse: (value: boolean) => void;
	setShowDragHandleOnHover: (value: boolean) => void;
	setAutoLaunchEnabled: (value: boolean) => void;
	setModel: (model: Live2DModel | null) => void;
	clearModel: () => void;
	setModelLoadStatus: (status: ModelLoadStatus, error?: string) => void;
	refreshMotions: () => string[];
	playMotion: (group: string) => void;
	interruptMotion: (group: string) => void;
	dumpMotionManager: () => void;
	setMotionText: (text: string | null) => void;
	setDebugModeEnabled: (value: boolean) => void;
	setForcedFollow: (value: boolean) => void;
}

export const DEFAULT_SCALE = 1;
export const MIN_SCALE = 0.3;
export const MAX_SCALE = 2;
export const DEFAULT_SHOW_DRAG_HANDLE_ON_HOVER = true;
export const DEFAULT_AUTO_LAUNCH = false;

const getPetApi = () => {
	if (typeof window === 'undefined') return undefined;
	return window.petAPI;
};

export function clampScale(value: number) {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

export const usePetStore = create<PetStoreState>((set, get) => {
	const motionManager = new MotionManager({ idleMinMs: 20000, idleMaxMs: 40000 });
	let updateScaleTimer: number | undefined = undefined;

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
		autoLaunchEnabled: DEFAULT_AUTO_LAUNCH,
		forcedFollow: false,
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
			if (api?.getSettings) {
				api.getSettings().then(remote => {
					if (!remote || typeof remote !== 'object') return;
					const patch: Partial<PetStoreState> = {};
					const persistPatch: Partial<PersistedSettings> = {};

					if (typeof remote.scale === 'number') {
						const clampedScale = clampScale(remote.scale);
						patch.scale = clampedScale;
						persistPatch.scale = clampedScale;
					}
					if (typeof remote.ignoreMouse === 'boolean') {
						patch.ignoreMouse = remote.ignoreMouse;
						persistPatch.ignoreMouse = remote.ignoreMouse;
					}
					if (typeof remote.showDragHandleOnHover === 'boolean') {
						patch.showDragHandleOnHover = remote.showDragHandleOnHover;
						persistPatch.showDragHandleOnHover = remote.showDragHandleOnHover;
					}
					if (typeof remote.autoLaunch === 'boolean') {
						patch.autoLaunchEnabled = remote.autoLaunch;
						persistPatch.autoLaunchEnabled = remote.autoLaunch;
					}
					if (typeof remote.forcedFollow === 'boolean') {
						patch.forcedFollow = remote.forcedFollow;
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
			if (api?.onSettingsUpdated) {
				off = api.onSettingsUpdated((newSettings) => {
					set({ ...newSettings });
				}) as (() => void) | undefined;
			}
			return off;
		},

		setScale: (value) => {
			const clamped = clampScale(Number.isFinite(value) ? value : DEFAULT_SCALE);
			set({ scale: clamped });
			clearTimeout(updateScaleTimer);
			updateScaleTimer = setTimeout(() => {
				const api = getPetApi();
				console.log('[PetStore] update scale', clamped);
				api?.updateSettings?.({scale: clamped}).catch((error: unknown) => {
					console.warn('[PetStore] update settings failed', error);
				});
				
			}, 500)
		},

		nudgeScale: (delta) => {
			const current = get().scale;
			const next = Math.round((current + delta) * 100) / 100;
			get().setScale(next);
		},

		resetScale: () => {
			get().setScale(DEFAULT_SCALE);
		},

		setIgnoreMouse: (value) => {
			set({ ignoreMouse: value });
			const api = getPetApi();
			console.log('[PetStore] update ignoreMouse', value);
			api?.updateSettings?.({ ignoreMouse: value }).catch((error: unknown) => {
				console.warn('[PetStore] update settings failed', error);
			});
		},

		setShowDragHandleOnHover: (value) => {
			set({ showDragHandleOnHover: value });
			const api = getPetApi();
			api?.updateSettings?.({ showDragHandleOnHover: value }).catch((error: unknown) => {
				console.warn('[PetStore] update settings failed', error);
			});
		},


		setAutoLaunchEnabled: (value) => {
			const nextValue = Boolean(value);
			set({ autoLaunchEnabled: nextValue });
			const api = getPetApi();
			api?.updateSettings?.({ autoLaunch: nextValue }).catch((error: unknown) => {
				console.warn('[PetStore] sync autoLaunch failed', error);
			});
		},
		setDebugModeEnabled(value) {
			set({ debugModeEnabled: value });
			const api = getPetApi();
			api?.updateSettings?.({ debugModeEnabled: value }).catch((error: unknown) => {
				console.warn('[PetStore] sync debugModeEnabled failed', error);
			});
		},

		setForcedFollow(value) {
			set({ forcedFollow: value });
			const api = getPetApi();
			api?.updateSettings?.({ forcedFollow: value }).catch((error: unknown) => {
				console.warn('[PetStore] sync forcedFollow failed', error);
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

		dumpMotionManager: () => {
			motionManager.dump();
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
