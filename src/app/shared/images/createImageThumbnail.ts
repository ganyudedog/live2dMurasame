/** 完整 data URL（含前缀）的持久化字符预算。 */
const MAX_THUMBNAIL_LENGTH = 64 * 1024;

export const isCacheableThumbnail = (value: unknown): value is string =>
  typeof value === 'string' && value.startsWith('data:image/') && value.length <= MAX_THUMBNAIL_LENGTH;

const loadImage = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
  const image = new Image();
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error('图片解码失败'));
  image.src = src;
});

/** 把图片缩到长边 maxSize 以内，供历史记录持久化；没有 DOM 或解码失败时返回 null。 */
export async function createImageThumbnail(src: string, maxSize = 320, quality = 0.78): Promise<string | null> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') return null;
  try {
    const image = await loadImage(src);
    const longest = Math.max(image.naturalWidth, image.naturalHeight);
    if (!longest) return null;
    let scale = Math.min(1, maxSize / longest);
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) return null;
    while (scale > 0) {
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const webp = canvas.toDataURL('image/webp', quality);
      const encoded = webp.startsWith('data:image/webp') ? webp : canvas.toDataURL('image/jpeg', quality);
      if (isCacheableThumbnail(encoded)) return encoded;
      if (canvas.width <= 1 && canvas.height <= 1) break;
      scale *= 0.75;
    }
    return null;
  } catch {
    return null;
  }
}
