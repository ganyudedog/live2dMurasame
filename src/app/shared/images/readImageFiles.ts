import { checkImageCount, MAX_IMAGE_BYTES } from '../../../../shared/ai/turnImages.js';

export async function readImageFiles(files: readonly File[]): Promise<string[]> {
  checkImageCount(files.length);
  for (const file of files) {
    if (file.size > MAX_IMAGE_BYTES) throw new Error('单张图片不能超过 5 MB');
    if (!file.size || !file.type.startsWith('image/')) throw new Error('请选择有效的图片文件');
  }
  return Promise.all(files.map(file => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('读取图片失败，请重新选择'));
    reader.readAsDataURL(file);
  })));
}
