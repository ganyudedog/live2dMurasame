import { useEffect } from 'react';
import type { ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  /** 标题行右侧的操作；关闭按钮固定在最后。 */
  actions?: ReactNode;
  size?: 'md' | 'lg';
  children: ReactNode;
}

/** 公用弹窗：只负责遮罩、标题行和可滚动内容区，业务内容由调用方提供。 */
export default function Modal({ open, title, description, onClose, actions, size = 'lg', children }: ModalProps) {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
    role="presentation" onMouseDown={onClose}>
    <section role="dialog" aria-modal="true" aria-label={title}
      className={`flex max-h-full w-full flex-col overflow-hidden rounded-box border border-base-300 bg-base-100 shadow-2xl
        ${size === 'lg' ? 'max-w-3xl' : 'max-w-xl'}`}
      onMouseDown={(event) => event.stopPropagation()}>
      <header className="flex shrink-0 items-start justify-between gap-3 border-b border-base-300 px-4 py-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{title}</h2>
          {description && <p className="mt-0.5 truncate text-xs text-base-content/50">{description}</p>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <button type="button" className="btn btn-ghost btn-xs" aria-label="关闭" onClick={onClose}>✕</button>
        </div>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{children}</div>
    </section>
  </div>;
}
