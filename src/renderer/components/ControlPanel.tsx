import React, { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { usePetStore } from '../state/usePetStore';

const formatScale = (value: number) => value.toFixed(2);

const getWindowFlag = (key: string) => {
	if (typeof window === 'undefined') return false;
	const win = window as unknown as Record<string, unknown>;
	return win[key] === true;
};


const setWindowFlag = (key: string, value: boolean) => {
	if (typeof window === 'undefined') return;
	const win = window as unknown as Record<string, unknown>;
	win[key] = value;
};

const ControlPanel: React.FC = () => {
	const scale = usePetStore(s => s.scale);
	const setScale = usePetStore(s => s.setScale);
	const nudgeScale = usePetStore(s => s.nudgeScale);
	const resetScale = usePetStore(s => s.resetScale);
	const ignoreMouse = usePetStore(s => s.ignoreMouse);
	const setIgnoreMouse = usePetStore(s => s.setIgnoreMouse);
	const modelLoadStatus = usePetStore(s => s.modelLoadStatus);
	const modelLoadError = usePetStore(s => s.modelLoadError);
	const availableMotions = usePetStore(s => s.availableMotions);
	const playingMotion = usePetStore(s => s.playingMotion);
	const refreshMotions = usePetStore(s => s.refreshMotions);
	const interruptMotion = usePetStore(s => s.interruptMotion);

	const showDragHandleOnHover = usePetStore(s => s.showDragHandleOnHover);
	const setShowDragHandleOnHover = usePetStore(s => s.setShowDragHandleOnHover);

	const autoLaunchEnabled = usePetStore(s => s.autoLaunchEnabled);
	const setAutoLaunchEnabled = usePetStore(s => s.setAutoLaunchEnabled);

	const loadSettings = usePetStore(s => s.loadSettings);

	const [motionDebug, setMotionDebug] = useState<boolean>(() => getWindowFlag('LIVE2D_MOTION_DEBUG'));
	const [eyeDebug, setEyeDebug] = useState<boolean>(() => getWindowFlag('LIVE2D_EYE_DEBUG'));
	const [forceFollow, setForceFollow] = useState<boolean>(() => getWindowFlag('LIVE2D_EYE_FORCE_ALWAYS'));
	
	// 控制面板初始化，因为electron中两边的状态是隔离的
	useLayoutEffect(() => {
		const off = loadSettings();
		return () => {
		  try {
			if(off !== undefined && typeof off === 'function') off();
		  } catch { /* empty */ }
		};
	  }, [loadSettings]);

	useEffect(() => {
		if (modelLoadStatus === 'loaded') {
			refreshMotions();
		}
	}, [modelLoadStatus, refreshMotions]);

	const statusBadge = useMemo(() => {
		switch (modelLoadStatus) {
			case 'loading':
				return { text: 'loading', className: 'badge badge-warning badge-sm' };
			case 'loaded':
				return { text: 'ready', className: 'badge badge-success badge-sm' };
			case 'error':
				return { text: 'error', className: 'badge badge-error badge-sm' };
			default:
				return { text: 'idle', className: 'badge badge-neutral badge-sm' };
		}
	}, [modelLoadStatus]);

	const handleScaleSlider = (event: React.ChangeEvent<HTMLInputElement>) => {
		setScale(parseFloat(event.target.value));
	};

	const handleToggleMotionDebug = () => {
		const next = !motionDebug;
		setWindowFlag('LIVE2D_MOTION_DEBUG', next);
		setMotionDebug(next);
	};

	const handleToggleEyeDebug = () => {
		const next = !eyeDebug;
		setWindowFlag('LIVE2D_EYE_DEBUG', next);
		setEyeDebug(next);
	};

	const handleToggleForceFollow = () => {
		const next = !forceFollow;
		setWindowFlag('LIVE2D_EYE_FORCE_ALWAYS', next);
		setForceFollow(next);
	};

	const handleMotionClick = (group: string) => {
		interruptMotion(group);
	};

	return (
		<div className="absolute top-4 left-4 z-10 w-80 pointer-events-auto">
			<div className="bg-base-200/80 backdrop-blur-md rounded-xl shadow-lg border border-base-300 p-4 space-y-4">
				<div className="flex items-center justify-between">
					<div>
						<h2 className="font-semibold text-base">Live2D 控制面板</h2>
						<p className="text-xs text-base-content/70">调整模型与调试选项</p>
					</div>
					<span className={statusBadge.className}>{statusBadge.text}</span>
				</div>
				{modelLoadError && (
					<p className="text-xs text-error">{modelLoadError}</p>
				)}

				<section className="space-y-2">
					<header className="flex items-center justify-between">
						<span className="font-medium text-sm">缩放</span>
						<span className="text-sm tabular-nums">{formatScale(scale)}</span>
					</header>
					<input
						type="range"
						min="0.3"
						max="2"
						step="0.01"
						value={scale}
						onChange={handleScaleSlider}
						className="range range-xs"
					/>
					<div className="flex gap-2">
						<button type="button" className="btn btn-xs btn-outline" onClick={() => nudgeScale(-0.05)}>-0.05</button>
						<button type="button" className="btn btn-xs btn-outline" onClick={() => nudgeScale(0.05)}>+0.05</button>
						<button type="button" className="btn btn-xs btn-outline" onClick={() => nudgeScale(-0.1)}>-0.10</button>
						<button type="button" className="btn btn-xs btn-outline" onClick={() => nudgeScale(0.1)}>+0.10</button>
						<button type="button" className="btn btn-xs" onClick={resetScale}>重置</button>
					</div>
				</section>

				<section className="space-y-2">
					<header className="font-medium text-sm">交互</header>
					<label className="label cursor-pointer justify-between p-0">
						<span className="label-text text-sm">忽略鼠标</span>
						<input type="checkbox" className="toggle toggle-sm" checked={ignoreMouse} onChange={e => setIgnoreMouse(e.target.checked)} />
					</label>
					<label className="label cursor-pointer justify-between p-0">
						<span className="label-text text-sm">悬浮显示拖动</span>
						<input type="checkbox" className="toggle toggle-sm" checked={showDragHandleOnHover} onChange={e => setShowDragHandleOnHover(e.target.checked)} />
					</label>
					<label className="label cursor-pointer justify-between p-0">
						<span className="label-text text-sm">开机自启动</span>
						<input type="checkbox" className="toggle toggle-sm" checked={autoLaunchEnabled} onChange={e => setAutoLaunchEnabled(e.target.checked)} />
					</label>
				</section>

				<section className="space-y-2">
					<header className="font-medium text-sm">动作控制</header>
					{availableMotions.length ? (
						<>
							<div className="flex flex-wrap gap-2">
								{availableMotions.map(group => (
									<button
										type="button"
										key={group}
										className={`btn btn-sm ${playingMotion === group ? 'btn-primary' : 'btn-outline'}`}
										onClick={() => handleMotionClick(group)}
									>
										{group}
									</button>
								))}
							</div>
							{playingMotion && (
								<p className="text-xs text-base-content/70">当前动作：{playingMotion}</p>
							)}
						</>
					) : (
						<p className="text-xs text-base-content/70">暂无动作分组，等待模型加载。</p>
					)}
				</section>

				<section className="space-y-3">
					<header className="font-medium text-sm">调试</header>
					<div className="flex flex-wrap gap-2">
						<button type="button" className={`btn btn-xs ${motionDebug ? 'btn-accent' : 'btn-outline'}`} onClick={handleToggleMotionDebug}>Motion Debug</button>
						<button type="button" className={`btn btn-xs ${eyeDebug ? 'btn-accent' : 'btn-outline'}`} onClick={handleToggleEyeDebug}>Eye Debug</button>
						<button type="button" className={`btn btn-xs ${forceFollow ? 'btn-accent' : 'btn-outline'}`} onClick={handleToggleForceFollow}>强制最终跟随</button>
					</div>
				</section>
			</div>
		</div>
	);
};

export default ControlPanel;