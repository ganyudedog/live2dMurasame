const TRACE_BUFFER_LIMIT = 800;
const TRACE_SAMPLE_MIN_MS = 80;
const TRACE_DEDUPE_WINDOW_MS = 450;
const TRACE_RATE_LIMIT_PER_SEC = 28;

const LEVEL_WEIGHT = {
	debug: 10,
	info: 20,
	warn: 30,
	error: 40,
};

const DEFAULT_TRACE_POLICY = {
	//默认模式为“设计静音”：保持诊断关键信号，抑制拖动噪声。
	minLevel: 'info',
	enabledProfiles: ['default', 'layout', 'model', 'modelLoad', 'perf', 'windowJump'],
	quietProfiles: ['singleWriter', 'windowMove', 'jitter', 'align'],
	// 不默认丢弃拖动主相位，改为走“静默档案 + 周期摘要”，避免“完全没输出”的错觉。
	dropPhases: [],
	summaryIntervalMs: 2500,
};

const traceBuffer = [];
const sampleState = new Map();
const dedupeState = new Map();
const consoleSuppressedState = new Map();

let rateWindowStart = Date.now();
let rateCounter = 0;
let lastSuppressedSummaryAt = 0;

let tracePolicy = {
	...DEFAULT_TRACE_POLICY,
	enabledProfiles: new Set(DEFAULT_TRACE_POLICY.enabledProfiles),
	quietProfiles: new Set(DEFAULT_TRACE_POLICY.quietProfiles),
	dropPhases: new Set(DEFAULT_TRACE_POLICY.dropPhases),
};

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const ALLOWED_GROUP_FIELDS = {
	request: ['source', 'rid', 'requestId', 'phase', 'ts', 'status', 'reason'],
	resizeCore: ['requiredWidth', 'requiredWindowWidth', 'enforcedWindowWidth', 'normalizedWidth', 'targetWidth', 'targetHeight', 'desiredHeight', 'stableHeight', 'isEnlarge', 'resizeInFlight', 'priority', 'intentEpoch'],
	window: ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'screenX', 'screenY', 'boundsWidth', 'boundsHeight', 'boundsX', 'boundsY', 'targetWindowWidth', 'pendingWidth', 'predictedBoundsX', 'predictedBoundsY', 'predictedBoundsWidth', 'predictedBoundsHeight', 'anchorCenter', 'anchorRight', 'targetX', 'targetY', 'mode', 'epoch', 'currentX', 'currentY', 'currentWidth', 'currentHeight', 'nextX', 'nextY', 'nextWidth', 'nextHeight', 'factX', 'factY', 'factWidth', 'factHeight', 'effectiveX', 'effectiveY', 'effectiveWidth', 'effectiveHeight', 'dragActiveUntil', 'settleUntil', 'settleApplied', 'lastAppliedIntentId', 'dragSessionState'],
	layout: ['baseFrameWidthDom', 'baseFrameLeftDom', 'visibleFrameWidthDom', 'visibleFrameCenterDomX', 'boundsWidthDom', 'boundsHeightDom', 'screenWidthDom', 'screenHeightDom', 'canvasRectWidthDom', 'canvasRectHeightDom', 'zoneTarget', 'gapEffective', 'effectiveContainerWidth', 'leftCapacity', 'rightCapacity', 'leftShortfallPx', 'rightShortfallPx', 'capacityShortfall', 'boundsToScreenRatio', 'kind', 'source', 'reason', 'stateFrom', 'stateTo', 'moveOnly', 'policySuppressed'],
	model: [
		'scaleUsed',
		'modelHeightDom',
		'hydrated',
		'hasActiveModelFileUrl',
		'activeModelFileUrl',
		'currentPath',
		'resolvedModelPath',
		'settingsLoaded',
		'error',
		'stageChildren',
		'modelScaleX',
		'modelScaleY',
		'modelX',
		'modelY',
		'boundsWidth',
		'boundsHeight',
		'localBoundsWidth',
		'localBoundsHeight',
		'containerWidth',
		'containerHeight',
		'rendererWidth',
		'rendererHeight',
	],
	perf: ['fps', 'frameId', 'costMs'],
};

const TRACE_PROFILE_FIELDS = {
	jitter: ['request', 'resizeCore', 'window', 'layout'],
	align: ['request', 'resizeCore', 'window'],
	layout: ['request', 'layout', 'resizeCore'],
	singleWriter: ['request', 'window', 'layout', 'resizeCore'],
	windowMove: ['request', 'window', 'layout'],
	model: ['request', 'model', 'layout'],
	modelLoad: ['request', 'model'],
	perf: ['request', 'perf', 'model'],
	windowJump: ['request', 'window', 'layout'],
	default: ['request', 'resizeCore', 'window'],
};

// 当消息过多时，进行裁剪，保留最新的 TRACE_BUFFER_LIMIT 条记录。
const pushTraceBuffer = (entry) => {
	traceBuffer.push(entry);
	if (traceBuffer.length > TRACE_BUFFER_LIMIT) {
		traceBuffer.splice(0, traceBuffer.length - TRACE_BUFFER_LIMIT);
	}
};

const normalizeSetInput = (value) => {
	if (Array.isArray(value)) return new Set(value.filter((v) => typeof v === 'string' && v));
	if (value instanceof Set) return new Set(Array.from(value).filter((v) => typeof v === 'string' && v));
	return null;
};

export const setDebugTracePolicy = (patch = {}) => {
	//  运行时安全更新：只允许已知的标量/集合字段。
	if (!isPlainObject(patch)) return getDebugTracePolicy();

	if (typeof patch.minLevel === 'string' && LEVEL_WEIGHT[patch.minLevel]) {
		tracePolicy.minLevel = patch.minLevel;
	}
	if (typeof patch.summaryIntervalMs === 'number' && Number.isFinite(patch.summaryIntervalMs) && patch.summaryIntervalMs >= 500) {
		tracePolicy.summaryIntervalMs = Math.floor(patch.summaryIntervalMs);
	}

	const enabledProfiles = normalizeSetInput(patch.enabledProfiles);
	if (enabledProfiles) tracePolicy.enabledProfiles = enabledProfiles;
	const quietProfiles = normalizeSetInput(patch.quietProfiles);
	if (quietProfiles) tracePolicy.quietProfiles = quietProfiles;
	const dropPhases = normalizeSetInput(patch.dropPhases);
	if (dropPhases) tracePolicy.dropPhases = dropPhases;

	return getDebugTracePolicy();
};

export const getDebugTracePolicy = () => ({
	minLevel: tracePolicy.minLevel,
	summaryIntervalMs: tracePolicy.summaryIntervalMs,
	enabledProfiles: Array.from(tracePolicy.enabledProfiles),
	quietProfiles: Array.from(tracePolicy.quietProfiles),
	dropPhases: Array.from(tracePolicy.dropPhases),
});

const pickGroup = (rawGroup, allowedFields) => {
	if (!isPlainObject(rawGroup)) return undefined;
	const result = {};
	for (const field of allowedFields) {
		const value = rawGroup[field];
		if (value == null) continue;
		if (typeof value === 'string' || typeof value === 'boolean' || isFiniteNumber(value)) {
			result[field] = value;
		}
	}
	return Object.keys(result).length ? result : undefined;
};

const normalizeTracePayload = (rawPayload = {}) => {
	if (!isPlainObject(rawPayload)) return null;

	const kind = typeof rawPayload.kind === 'string' && rawPayload.kind ? rawPayload.kind : 'resize';
	const profile = typeof rawPayload.profile === 'string' && rawPayload.profile ? rawPayload.profile : 'default';
	const level = rawPayload.level === 'warn' || rawPayload.level === 'error' || rawPayload.level === 'debug'
		? rawPayload.level
		: 'debug';

	const request = pickGroup(rawPayload.request, ALLOWED_GROUP_FIELDS.request) ?? pickGroup(rawPayload, ALLOWED_GROUP_FIELDS.request);
	if (request && typeof request.source !== 'string') {
		delete request.source;
	}

	const resizeCore = pickGroup(rawPayload.resizeCore, ALLOWED_GROUP_FIELDS.resizeCore) ?? pickGroup(rawPayload, ALLOWED_GROUP_FIELDS.resizeCore);
	const windowGroup = pickGroup(rawPayload.window, ALLOWED_GROUP_FIELDS.window) ?? pickGroup(rawPayload, ALLOWED_GROUP_FIELDS.window);
	const layout = pickGroup(rawPayload.layout, ALLOWED_GROUP_FIELDS.layout) ?? pickGroup(rawPayload, ALLOWED_GROUP_FIELDS.layout);
	const model = pickGroup(rawPayload.model, ALLOWED_GROUP_FIELDS.model) ?? pickGroup(rawPayload, ALLOWED_GROUP_FIELDS.model);
	const perf = pickGroup(rawPayload.perf, ALLOWED_GROUP_FIELDS.perf) ?? pickGroup(rawPayload, ALLOWED_GROUP_FIELDS.perf);

	// 构建严格的形状，以便下游过滤器可以依赖于稳定的键。
	const normalized = {
		kind,
		profile,
		level,
		request,
		resizeCore,
		window: windowGroup,
		layout,
		model,
		perf,
	};

	return normalized;
};

const shouldPassRateLimit = () => {
	const now = Date.now();
	if (now - rateWindowStart >= 1000) {
		rateWindowStart = now;
		rateCounter = 0;
	}
	rateCounter += 1;
	return rateCounter <= TRACE_RATE_LIMIT_PER_SEC;
};

const shouldPassSample = (normalized) => {
	const source = normalized?.request?.source ?? 'unknown';
	const phase = normalized?.request?.phase ?? 'na';
	const profile = normalized?.profile ?? 'default';
	const key = `${profile}|${phase}|${source}`;
	const now = Date.now();
	const last = sampleState.get(key) ?? 0;
	if (now - last < TRACE_SAMPLE_MIN_MS) return false;
	sampleState.set(key, now);
	return true;
};

const withDedupe = (normalized) => {
	const profile = normalized?.profile ?? 'default';
	const phase = normalized?.request?.phase ?? 'na';
	const rid = normalized?.request?.rid ?? normalized?.request?.requestId ?? 'no-rid';
	const width = normalized?.resizeCore?.normalizedWidth ?? normalized?.resizeCore?.targetWidth ?? 'na';
	const reason = normalized?.request?.reason ?? normalized?.layout?.reason ?? 'na';
	const jumpX = normalized?.window?.nextX ?? normalized?.window?.effectiveX ?? normalized?.window?.factX ?? 'na';
	const jumpY = normalized?.window?.nextY ?? normalized?.window?.effectiveY ?? normalized?.window?.factY ?? 'na';
	const jumpWidth = normalized?.window?.nextWidth ?? normalized?.window?.effectiveWidth ?? normalized?.window?.factWidth ?? 'na';
	const jumpHeight = normalized?.window?.nextHeight ?? normalized?.window?.effectiveHeight ?? normalized?.window?.factHeight ?? 'na';
	const signature = profile === 'windowJump'
		? `${profile}|${phase}|${reason}|${rid}|${jumpX}|${jumpY}|${jumpWidth}|${jumpHeight}`
		: `${profile}|${phase}|${rid}|${width}`;
	const now = Date.now();
	const existing = dedupeState.get(signature);
	if (!existing) {
		dedupeState.set(signature, { lastAt: now, count: 0 });
		return { suppressed: 0 };
	}
	if (now - existing.lastAt <= TRACE_DEDUPE_WINDOW_MS) {
		existing.count += 1;
		existing.lastAt = now;
		return null;
	}
	const suppressed = existing.count;
	existing.count = 0;
	existing.lastAt = now;
	return { suppressed };
};

const selectFieldsByProfile = (normalized) => {
	const groups = TRACE_PROFILE_FIELDS[normalized.profile] ?? TRACE_PROFILE_FIELDS.default;
	const output = {};
	for (const groupName of groups) {
		const value = normalized[groupName];
		if (value && isPlainObject(value) && Object.keys(value).length) {
			output[groupName] = value;
		}
	}
	return output;
};

const shouldKeepTrace = (normalized) => {
	// 第1道门：保留 warn/error；其余按 level/profile/phase 策略过滤。
	const level = normalized?.level ?? 'debug';
	if (level === 'warn' || level === 'error') return true;

	const profile = normalized?.profile ?? 'default';
	// quietProfiles 即使低于 minLevel 也会保留，用于缓冲与摘要统计。
	if (tracePolicy.quietProfiles.has(profile)) return true;

	const minLevelWeight = LEVEL_WEIGHT[tracePolicy.minLevel] ?? LEVEL_WEIGHT.info;
	const levelWeight = LEVEL_WEIGHT[level] ?? LEVEL_WEIGHT.debug;
	if (levelWeight < minLevelWeight) return false;

	if (tracePolicy.enabledProfiles.size > 0 && !tracePolicy.enabledProfiles.has(profile)) return false;

	const phase = normalized?.request?.phase;
	if (typeof phase === 'string' && phase && tracePolicy.dropPhases.has(phase)) return false;

	return true;
};

const shouldPrintToConsole = (normalized) => {
	// 门2：控制台通道有意收窄跟踪缓冲通道。
	const level = normalized?.level ?? 'debug';
	if (level === 'warn' || level === 'error') return true;

	const profile = normalized?.profile ?? 'default';
	if (tracePolicy.quietProfiles.has(profile)) return false;

	// 默认情况下仅为模型诊断保留信息;调试跟踪保留在缓冲区中。
	if (level === 'info') return profile === 'modelLoad' || profile === 'model' || profile === 'perf' || profile === 'windowJump';
	return false;
};

const markConsoleSuppressed = (normalized) => {
	// 定期发出抑制摘要，以便知道什么被折叠。
	const profile = normalized?.profile ?? 'default';
	const phase = normalized?.request?.phase ?? 'na';
	const key = `${profile}|${phase}`;
	const now = Date.now();
	const existing = consoleSuppressedState.get(key) ?? { count: 0, profile, phase };
	existing.count += 1;
	consoleSuppressedState.set(key, existing);

	if (now - lastSuppressedSummaryAt < tracePolicy.summaryIntervalMs) return;
	lastSuppressedSummaryAt = now;

	const top = Array.from(consoleSuppressedState.values())
		.sort((a, b) => b.count - a.count)
		.slice(0, 3)
		.map((item) => `${item.profile}/${item.phase}:${item.count}`)
		.join(', ');

	if (!top) return;
	if (typeof console.info === 'function') {
		console.info('[pet][trace-summary]', { suppressed: top });
	} else {
		console.log('[pet][trace-summary]', { suppressed: top });
	}
	consoleSuppressedState.clear();
};

export const logPetEvent = (event, payload = {}, options = {}) => {
	const level = options.level === 'warn' || options.level === 'error' || options.level === 'debug' ? options.level : 'info';
	const entry = { t: Date.now(), ns: 'pet', event, payload };
	pushTraceBuffer(entry);

	if (level === 'warn') {
		console.warn('[pet]', event, payload);
		return;
	}
	if (level === 'error') {
		console.error('[pet]', event, payload);
		return;
	}
	if (level === 'debug') {
		if (typeof console.debug === 'function') console.debug('[pet]', event, payload);
		else console.log('[pet]', event, payload);
		return;
	}
	console.log('[pet]', event, payload);
};

export const logDebugTrace = (rawPayload = {}) => {
	// 处理管道：标准化 -> 策略过滤 -> 全局限流/采样/去重 -> 输出分流。
	const normalized = normalizeTracePayload(rawPayload);
	if (!normalized) return;
	if (!shouldKeepTrace(normalized)) return;
	// if (!shouldPassRateLimit()) return;
	// if (!shouldPassSample(normalized)) return;
	const dedupeMeta = withDedupe(normalized);
	if (!dedupeMeta) return;

	const selected = selectFieldsByProfile(normalized);
	const payload = {
		kind: normalized.kind,
		profile: normalized.profile,
		...selected,
		dedupe: dedupeMeta.suppressed > 0 ? { suppressed: dedupeMeta.suppressed } : undefined,
	};

	pushTraceBuffer({ t: Date.now(), ns: 'pet', event: 'trace', payload });

	if (!shouldPrintToConsole(normalized)) {
		markConsoleSuppressed(normalized);
		return;
	}

	const level = normalized.level;
	if (level === 'warn') {
		console.warn('[pet][trace]', payload);
	} else if (level === 'error') {
		console.error('[pet][trace]', payload);
	} else if (level === 'info') {
		if (typeof console.info === 'function') console.info('[pet][trace]', payload);
		else console.log('[pet][trace]', payload);
	} else if (typeof console.debug === 'function') {
		console.debug('[pet][trace]', payload);
	} else {
		console.log('[pet][trace]', payload);
	}
};

export const getRecentPetLogs = () => traceBuffer.slice();

export const clearRecentPetLogs = () => {
	traceBuffer.splice(0, traceBuffer.length);
};

