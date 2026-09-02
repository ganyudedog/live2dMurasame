const MIN_WINDOW_WIDTH = 75;
const MIN_WINDOW_HEIGHT = 250;

const finiteOr = (value, fallback) => Number.isFinite(value) ? value : fallback;

/**
 * Canonical window-intent normalization shared by Renderer prediction and Electron Main.
 * Keeping integer conversion here makes an ordinary scale resize exactly predictable.
 */
export const resolveWindowIntentBounds = (currentBounds, intent = {}) => {
  const payload = intent?.payload ?? {};
  const kind = intent?.kind;
  const next = {
    x: currentBounds.x,
    y: currentBounds.y,
    width: currentBounds.width,
    height: currentBounds.height,
  };

  if (kind === 'position' || kind === 'bounds') {
    if (Number.isFinite(payload.x)) next.x = Math.round(payload.x);
    if (Number.isFinite(payload.y)) next.y = Math.round(payload.y);
  }
  if (kind === 'size' || kind === 'bounds') {
    if (Number.isFinite(payload.width)) next.width = Math.max(MIN_WINDOW_WIDTH, Math.floor(payload.width));
    if (Number.isFinite(payload.height)) next.height = Math.max(MIN_WINDOW_HEIGHT, Math.floor(payload.height));
  }
  if (kind === 'size' && Number.isFinite(payload.anchorCenter)) {
    next.x = Math.round(payload.anchorCenter - next.width / 2);
  }

  return next;
};

/** Builds one complete projected snapshot; callers never combine it with older geometry. */
export const projectWindowGeometry = (confirmedGeometry, intentId, intent) => {
  if (!confirmedGeometry?.bounds || !confirmedGeometry?.contentBounds) return null;

  const confirmedBounds = confirmedGeometry.bounds;
  const confirmedContent = confirmedGeometry.contentBounds;
  const leftInset = confirmedContent.x - confirmedBounds.x;
  const topInset = confirmedContent.y - confirmedBounds.y;
  const horizontalInset = confirmedBounds.width - confirmedContent.width;
  const verticalInset = confirmedBounds.height - confirmedContent.height;
  let bounds;
  let contentBounds;

  if (intent?.kind === 'size') {
    // Renderer layout requests are content-area dimensions. Electron applies the
    // same rectangle with setContentBounds, while outer bounds remain diagnostic.
    contentBounds = resolveWindowIntentBounds(confirmedContent, intent);
    bounds = {
      x: contentBounds.x - leftInset,
      y: contentBounds.y - topInset,
      width: contentBounds.width + horizontalInset,
      height: contentBounds.height + verticalInset,
    };
  } else {
    bounds = resolveWindowIntentBounds(confirmedBounds, intent);
    contentBounds = {
      x: bounds.x + leftInset,
      y: bounds.y + topInset,
      width: Math.max(1, bounds.width - horizontalInset),
      height: Math.max(1, bounds.height - verticalInset),
    };
  }

  return {
    intentId,
    geometry: {
      bounds,
      contentBounds,
      workArea: { ...confirmedGeometry.workArea },
      displayId: finiteOr(confirmedGeometry.displayId, 0),
      scaleFactor: finiteOr(confirmedGeometry.scaleFactor, 1),
    },
  };
};

/** Maximum coordinate/size delta in device-independent pixels. */
export const getWindowGeometryError = (predicted, actual) => {
  if (!predicted || !actual) return Number.POSITIVE_INFINITY;
  return Math.max(
    Math.abs(predicted.bounds.x - actual.bounds.x),
    Math.abs(predicted.bounds.y - actual.bounds.y),
    Math.abs(predicted.bounds.width - actual.bounds.width),
    Math.abs(predicted.bounds.height - actual.bounds.height),
    Math.abs(predicted.contentBounds.x - actual.contentBounds.x),
    Math.abs(predicted.contentBounds.y - actual.contentBounds.y),
    Math.abs(predicted.contentBounds.width - actual.contentBounds.width),
    Math.abs(predicted.contentBounds.height - actual.contentBounds.height),
  );
};

/** Visual correction is determined by content bounds because Pixi renders there. */
export const getWindowContentGeometryError = (predicted, actual) => {
  if (!predicted || !actual) return Number.POSITIVE_INFINITY;
  return Math.max(
    Math.abs(predicted.contentBounds.x - actual.contentBounds.x),
    Math.abs(predicted.contentBounds.y - actual.contentBounds.y),
    Math.abs(predicted.contentBounds.width - actual.contentBounds.width),
    Math.abs(predicted.contentBounds.height - actual.contentBounds.height),
  );
};
