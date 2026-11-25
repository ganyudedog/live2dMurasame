export const MAX_IMAGES = 4;
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

export function checkImageCount(count) {
  if (count > MAX_IMAGES) throw new Error('每轮最多可发送 4 张图片');
}

export function imageStats(images = []) {
  if (!Array.isArray(images)) throw new Error('图片必须是列表');
  checkImageCount(images.length);
  let imageBytes = 0;
  for (const url of images) {
    const header = typeof url === 'string' && /^data:image\/[a-z0-9.+-]{1,64};base64,/i.exec(url);
    if (!header) throw new Error('图片数据地址无效');
    const length = url.length - header[0].length;
    const bytes = length / 4 * 3 - (url.endsWith('==') ? 2 : url.endsWith('=') ? 1 : 0);
    if (bytes > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 5 MB');
    if (!length || length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(url.slice(header[0].length))) throw new Error('图片编码无效');
    imageBytes += bytes;
  }
  return { imageCount: images.length, imageBytes };
}

// Channels may supply bytes without a Content-Type (e.g. OneBot get_image).
export function imageFromBase64(encoded, mime) {
  if (!mime?.startsWith('image/')) {
    if (encoded.startsWith('iVBORw0KGgo')) mime = 'image/png';
    else if (encoded.startsWith('/9j/')) mime = 'image/jpeg';
    else if (encoded.startsWith('R0lGOD')) mime = 'image/gif';
    else if (encoded.startsWith('UklGR') && atob(encoded.slice(0, 16)).endsWith('WEBP')) mime = 'image/webp';
    else if (encoded.startsWith('Qk')) mime = 'image/bmp';
    else throw new Error('无法确定图片格式');
  }
  const url = `data:${mime};base64,${encoded}`;
  imageStats([url]);
  return url;
}

// Providers may quote the input in a reply or error. Strip it before any bounded preview or journal write.
export function redactImageData(text, images) {
  let clean = text.replace(/data:image\/[a-z0-9.+-]+;base64,[A-Za-z0-9+/=]*/gi, '[图片]');
  for (const url of images ?? []) {
    const encoded = url.slice(url.indexOf(',') + 1);
    if (encoded && clean.includes(encoded)) clean = clean.replaceAll(encoded, '[图片]');
  }
  return clean;
}
