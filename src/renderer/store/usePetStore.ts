import { create } from 'zustand';
import type { Live2DModel } from '../components/pet/live2dManage/runtime';
import { MotionManager } from '../components/pet/live2dManage/motionManager';

type ModelLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

interface PetStoreState {
	model: Live2DModel | null;
	modelLoadStatus: ModelLoadStatus;
	modelLoadError?: string;
	availableMotions: string[];
	playingMotion: string | null;
	playingMotionText: string | null;
	playingMotionSound: string | null;
	motionManager: MotionManager;
	setModel: (model: Live2DModel | null) => void;
	clearModel: () => void;
	setModelLoadStatus: (status: ModelLoadStatus, error?: string) => void;
	refreshMotions: () => string[];
	playMotion: (group: string) => void;
	interruptMotion: (group: string) => void;
	setMotionText: (text: string | null) => void;
}

export const usePetStore = create<PetStoreState>((set) => {
	const motionManager = new MotionManager({ idleMinMs: 20000, idleMaxMs: 40000 });

	const attachModelToManager = (model: Live2DModel | null) => {
		motionManager.dispose();
		if (model) {
			motionManager.attach(model);
		}
		return motionManager.getGroups();
	};

	return {
		model: null,
		modelLoadStatus: 'idle',
		modelLoadError: undefined,
		availableMotions: [],
		playingMotion: null,
		playingMotionText: null,
		playingMotionSound: null,
		motionManager,

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
