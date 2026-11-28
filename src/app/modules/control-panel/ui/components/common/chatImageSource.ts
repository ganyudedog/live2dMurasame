export interface ChatImageSource {
  /** 原图，仅本次会话内可用。 */
  images?: readonly string[];
  /** 持久化的缩略图。 */
  thumbnails?: readonly string[];
  imageCount?: number;
}

const PLACEHOLDER_TEXT = /^\[附有 \d+ 张图片\]$/;

/** 只发了图片时，请求里的占位文字不必再显示成一条气泡。 */
export const isImagePlaceholderText = (text: string, source: ChatImageSource) =>
  Boolean(source.imageCount || source.images?.length || source.thumbnails?.length) && PLACEHOLDER_TEXT.test(text.trim());
