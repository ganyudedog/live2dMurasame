export const MAX_IMAGES: number;
export const MAX_IMAGE_BYTES: number;
export function checkImageCount(count: number): void;
export function imageStats(images?: readonly string[]): { imageCount: number; imageBytes: number };
export function imageFromBase64(encoded: string, mime?: string): string;
export function redactImageData(text: string, images?: readonly string[]): string;
