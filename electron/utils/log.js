const TRACE_BUFFER_LIMIT = 800;
const TRACE_SAMPLE_MIN_MS = 80;
const TRACE_DEDUPE_WINDOW_MS = 450;
const TRACE_RATE_LIMIT_PER_SEC = 35;

const traceBuffer = [];
const sampleState = new Map();
const dedupeState = new Map();

let rateWindowStart = Date.now();
let rateCounter = 0;

const isFiniteNumber = (value) => typeof value === 'number' && Number.isFinite(value);
const isPlainObject = (value) => typeof value === 'object' && value !== null && !Array.isArray(value);

const ALLOWED_GROUP_FIELDS = {
	request: ['source', 'rid', 'requestId', 'phase', 'ts', 'status', 'reason'],
	resizeCore: ['requiredWidth', 'requiredWindowWidth', 'enforcedWindowWidth', 'normalizedWidth', 'targetWidth', 'targetHeight', 'desiredHeight', 'isEnlarge', 'resizeInFlight', 'priority', 'intentEpoch'],
	window: ['innerWidth', 'innerHeight', 'outerWidth', 'outerHeight', 'screenX', 'screenY', 'boundsWidth', 'boundsHeight', 'boundsX', 'boundsY', 'targetWindowWidth', 'pendingWidth', 'predictedBoundsX', 'predictedBoundsY', 'predictedBoundsWidth', 'predictedBoundsHeight', 'anchorCenter', 'anchorRight', 'targetX', 'targetY', 'mode', 'epoch', 'currentX', 'currentY', 'currentWidth', 'currentHeight', 'nextX', 'nextY', 'nextWidth', 'nextHeight', 'dragActiveUntil', 'settleUntil', 'settleApplied', 'lastAppliedIntentId'],
	layout: ['baseFrameWidthDom', 'baseFrameLeftDom', 'visibleFrameWidthDom', 'visibleFrameCenterDomX', 'boundsWidthDom', 'boundsHeightDom', 'screenWidthDom', 'screenHeightDom', 'canvasRectWidthDom', 'canvasRectHeightDom', 'zoneTarget', 'gapEffective', 'effectiveContainerWidth', 'leftCapacity', 'rightCapacity', 'leftShortfallPx', 'rightShortfallPx', 'capacityShortfall', 'boundsToScreenRatio', 'kind', 'source', 'reason', 'stateFrom', 'stateTo'],
	model: ['scaleUsed', 'modelHeightDom'],
	perf: ['fps', 'frameId', 'costMs'],
};

const TRACE_PROFILE_FIELDS = {
	jitter: ['request', 'resizeCore', 'window', 'layout'],
	align: ['request', 'resizeCore', 'window'],
	layout: ['request', 'layout', 'resizeCore'],
	singleWriter: ['request', 'window', 'layout', 'resizeCore'],
	windowMove: ['request', 'window', 'layout'],
	model: ['request', 'model', 'layout'],
	perf: ['request', 'perf', 'model'],
	default: ['request', 'resizeCore', 'window'],
};

const pushTraceBuffer = (entry) => {
	traceBuffer.push(entry);
	if (traceBuffer.length > TRACE_BUFFER_LIMIT) {
		traceBuffer.splice(0, traceBuffer.length - TRACE_BUFFER_LIMIT);
	}
};

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
	const signature = `${profile}|${phase}|${rid}|${width}`;
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
	const normalized = normalizeTracePayload(rawPayload);
	if (!normalized) return;
	if (!shouldPassRateLimit()) return;
	if (!shouldPassSample(normalized)) return;
	const dedupeMeta = withDedupe(normalized);
	if (!dedupeMeta) return;

	const selected = selectFieldsByProfile(normalized);
	const payload = {
		kind: normalized.kind,
		profile: normalized.profile,
		...selected,
		dedupe: dedupeMeta.suppressed > 0 ? { suppressed: dedupeMeta.suppressed } : undefined,
	};

	const level = normalized.level;
	if (level === 'warn') {
		console.warn('[pet][trace]', payload);
	} else if (level === 'error') {
		console.error('[pet][trace]', payload);
	} else if (typeof console.debug === 'function') {
		console.debug('[pet][trace]', payload);
	} else {
		console.log('[pet][trace]', payload);
	}

	pushTraceBuffer({ t: Date.now(), ns: 'pet', event: 'trace', payload });
};

export const getRecentPetLogs = () => traceBuffer.slice();

export const clearRecentPetLogs = () => {
	traceBuffer.splice(0, traceBuffer.length);
};

