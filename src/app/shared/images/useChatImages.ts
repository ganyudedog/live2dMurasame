import { useEffect, useRef, useState } from 'react';
import type { ClipboardEventHandler, DragEvent } from 'react';
import { checkImageCount, MAX_IMAGES } from '../../../../shared/ai/turnImages.js';
import { readImageFiles } from './readImageFiles';

export interface ChatImageAttachment {
  id: string;
  name: string;
  url: string;
}

const hasFiles = (event: DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes('Files');
const imageFiles = (files: ArrayLike<File> | null | undefined) =>
  Array.from(files ?? []).filter((file) => file.type.startsWith('image/'));

/** 本轮待发送的图片：选择、粘贴、拖放都走这里；发送时一次性交出 data URL。 */
export function useChatImages() {
  const [attachments, setAttachments] = useState<ChatImageAttachment[]>([]);
  const [error, setError] = useState('');
  const [reading, setReading] = useState(false);
  const [dragDepth, setDragDepth] = useState(0);
  const locked = useRef(false);
  const revision = useRef(0);
  const nextId = useRef(0);
  useEffect(() => () => { revision.current++; }, []);

  function clear() {
    revision.current++;
    setAttachments([]);
    setError('');
    setReading(false);
  }

  function remove(id: string) {
    setAttachments((current) => current.filter((item) => item.id !== id));
    setError('');
  }

  async function addFiles(files: readonly File[]) {
    if (!files.length || reading) return;
    const current = revision.current;
    setError('');
    try {
      checkImageCount(attachments.length + files.length);
      setReading(true);
      const urls = await readImageFiles(files);
      if (revision.current !== current) return;
      setAttachments((existing) => [...existing, ...files.map((file, index) => ({
        id: `${file.name}:${file.lastModified}:${nextId.current++}`, name: file.name, url: urls[index],
      }))]);
    } catch (cause) {
      if (revision.current === current) setError(cause instanceof Error ? cause.message : '读取图片失败');
    } finally {
      if (revision.current === current) setReading(false);
    }
  }

  const onPaste: ClipboardEventHandler<HTMLElement> = (event) => {
    const images = imageFiles(event.clipboardData?.files);
    if (!images.length) return;
    event.preventDefault();
    void addFiles(images);
  };

  // dragenter/dragleave 会在子元素之间成对触发，用计数判断是否真的离开了投放区。
  const dropProps = {
    onDragEnter: (event: DragEvent) => { if (hasFiles(event)) { event.preventDefault(); setDragDepth((depth) => depth + 1); } },
    onDragOver: (event: DragEvent) => { if (hasFiles(event)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } },
    onDragLeave: (event: DragEvent) => { if (hasFiles(event)) setDragDepth((depth) => Math.max(0, depth - 1)); },
    onDrop: (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      setDragDepth(0);
      const images = imageFiles(event.dataTransfer.files);
      if (images.length) void addFiles(images);
      else setError('只能添加图片文件');
    },
  };

  async function submit(send: (images?: readonly string[]) => void) {
    if (locked.current || reading || error) return false;
    locked.current = true;
    try {
      send(attachments.length ? attachments.map((item) => item.url) : undefined);
      setAttachments([]);
      setError('');
      return true;
    } finally {
      locked.current = false;
    }
  }

  return {
    attachments, error, reading, dragging: dragDepth > 0, count: attachments.length, max: MAX_IMAGES,
    addFiles, remove, clear, dismissError: () => setError(''), onPaste, dropProps, submit,
  };
}

export type ChatImages = ReturnType<typeof useChatImages>;
