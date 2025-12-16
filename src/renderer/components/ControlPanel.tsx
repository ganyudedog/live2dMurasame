import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { usePetStore } from '../store/usePetStore';

const formatScale = (value: number) => value.toFixed(2);
const ControlPanel: React.FC = () => {
	// 模型大小
	const scale = usePetStore(s => s.scale);
	const setScale = usePetStore(s => s.setScale);
	const nudgeScale = usePetStore(s => s.nudgeScale);
	const resetScale = usePetStore(s => s.resetScale);
	// 是否忽视鼠标
	const ignoreMouse = usePetStore(s => s.ignoreMouse);
	const setIgnoreMouse = usePetStore(s => s.setIgnoreMouse);

	// 调试模式
	const debugModeEnabled = usePetStore(s => s.debugModeEnabled);
	const setDebugModeEnabled = usePetStore(s => s.setDebugModeEnabled);

	// 模型强制跟随鼠标
	const forcedFollow = usePetStore(s => s.forcedFollow);
	const setForcedFollow = usePetStore(s => s.setForcedFollow);
	

	// 模型的加载
	const modelLoadStatus = usePetStore(s => s.modelLoadStatus);
	const modelLoadError = usePetStore(s => s.modelLoadError);
	const availableMotions = usePetStore(s => s.availableMotions);
	const playingMotion = usePetStore(s => s.playingMotion);
	const refreshMotions = usePetStore(s => s.refreshMotions);
	const interruptMotion = usePetStore(s => s.interruptMotion);

	// 展示拖动条
	const showDragHandleOnHover = usePetStore(s => s.showDragHandleOnHover);
	const setShowDragHandleOnHover = usePetStore(s => s.setShowDragHandleOnHover);

	// 开机自启动
	const autoLaunchEnabled = usePetStore(s => s.autoLaunchEnabled);
	const setAutoLaunchEnabled = usePetStore(s => s.setAutoLaunchEnabled);

	// 初始化
	const loadSettings = usePetStore(s => s.loadSettings);

	// 拖动条编辑锁，防止外部回流写入
	const [tempScale, setTempScale] = useState(scale);
	const editRef = useRef<boolean>(false);
	const debounceRef = useRef<number | null>(null);
	
	// 控制面板初始化，因为electron两边的状态是隔离的
	useLayoutEffect(() => {
		loadSettings();
	},[loadSettings]);

	useLayoutEffect(() => {
		if (!editRef.current) return;
		setScale(scale);
	// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [scale])
	
	const commitScale = (finalValue: number) => {
		setScale(finalValue); // 触发真正的 IPC
	};

	const scheduleCommit = (value: number) => {
		if (debounceRef.current) {
			clearTimeout(debounceRef.current);
		}
		debounceRef.current = setTimeout(() => {
			editRef.current = false;
			commitScale(value);
		}, 120);
	};

	const handleScaleSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
		const v = parseFloat(e.target.value);
		editRef.current = true;
		setTempScale(v);         // 仅本地更新，UI 丝滑
		scheduleCommit(v);       // 停止拖动 120ms 后再提交
	};

	//清除副作用
	useEffect(() => {
		return () => {
			if (debounceRef.current) clearTimeout(debounceRef.current);
		};
	}, []);

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
						value={tempScale}
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
					<label className="label cursor-pointer justify-between p-0">
						<span className="label-text text-sm">调试模式</span>
						<input type="checkbox" className="toggle toggle-sm" checked={debugModeEnabled} onChange={e => setDebugModeEnabled(e.target.checked)} />
					</label>
					<label className="label cursor-pointer justify-between p-0">
						<span className="label-text text-sm">强制最终跟随</span>
						<input type="checkbox" className="toggle toggle-sm" checked={forcedFollow} onChange={e => setForcedFollow(e.target.checked)} />
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
			</div>
		</div>
	);
};

export default ControlPanel;