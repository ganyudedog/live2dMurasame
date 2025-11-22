import { create } from 'zustand';
import type { Live2DModel } from '../live2d/runtime';
import { MotionManager } from '../live2d/motionManager';

type ModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface PersistedSettings {
	scale: number;
	ignoreMouse: boolean;
}

interface PetStoreState {
	scale: number;
	ignoreMouse: boolean;
	model: Live2DModel | null;
	modelLoadStatus: ModelLoadStatus;
	modelLoadError?: string;
	availableMotions: string[];
	playingMotion: string | null;
	playingMotionText: string | null;
	playingMotionSound: string | null;
	settingsLoaded: boolean;
	motionManager: MotionManager;
	loadSettings: () => void;
	setScale: (value: number) => void;
	nudgeScale: (delta: number) => void;
	resetScale: () => void;
	setIgnoreMouse: (value: boolean) => void;
	toggleIgnoreMouse: () => void;
	setModel: (model: Live2DModel | null) => void;
	clearModel: () => void;
	setModelLoadStatus: (status: ModelLoadStatus, error?: string) => void;
	refreshMotions: () => string[];
	playMotion: (group: string) => void;
	interruptMotion: (group: string) => void;
	dumpMotionManager: () => void;
	setMotionText: (text: string | null) => void;
}

const SETTINGS_KEY = 'pet-settings';
const DEFAULT_SCALE = 1;
const MIN_SCALE = 0.3;
const MAX_SCALE = 2;

function clampScale(value: number) {
	return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
}

function readPersistedSettings(): Partial<PersistedSettings> {
	if (typeof window === 'undefined') return {};
	try {
		const raw = window.localStorage.getItem(SETTINGS_KEY);
		if (!raw) return {};
		return JSON.parse(raw) as Partial<PersistedSettings>;
	} catch (err) {
		console.warn('[PetStore] read settings failed', err);
		return {};
	}
}

function writePersistedSettings(next: Partial<PersistedSettings>) {
	if (typeof window === 'undefined') return;
	try {
		const current = readPersistedSettings();
		const merged = { ...current, ...next } as PersistedSettings;
		window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
	} catch (err) {
		console.warn('[PetStore] write settings failed', err, next);
	}
}

export const usePetStore = create<PetStoreState>((set, get) => {
	const motionManager = new MotionManager({ idleMinMs: 20000, idleMaxMs: 40000 });

	const persist = (partial: Partial<PersistedSettings>) => {
		writePersistedSettings(partial);
	};

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
		model: null,
		modelLoadStatus: 'idle',
		modelLoadError: undefined,
		availableMotions: [],
		playingMotion: null,
		playingMotionText: null,
		playingMotionSound: null,
		settingsLoaded: false,
		motionManager,

		loadSettings: () => {
			if (get().settingsLoaded) return;
			const saved = readPersistedSettings();
			const next: Partial<PetStoreState> = {};
			if (typeof saved.scale === 'number') {
				next.scale = clampScale(saved.scale);
			}
			if (typeof saved.ignoreMouse === 'boolean') {
				next.ignoreMouse = saved.ignoreMouse;
			}
			set({ ...next, settingsLoaded: true });
		},

		setScale: (value) => {
			const clamped = clampScale(Number.isFinite(value) ? value : DEFAULT_SCALE);
			set({ scale: clamped });
			persist({ scale: clamped });
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
			persist({ ignoreMouse: value });
		},

		toggleIgnoreMouse: () => {
			const next = !get().ignoreMouse;
			get().setIgnoreMouse(next);
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
