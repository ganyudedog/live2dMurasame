import type { ReactNode } from 'react';
import { Dialog } from 'radix-ui';
import { X } from 'lucide-react';
import { Button } from './Button';
import { cn } from './cn';

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
  return <Dialog.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="fixed inset-0 z-50 bg-black/35 backdrop-blur-[2px] dark:bg-black/55
        data-[state=open]:animate-[ui-fade-in_150ms_ease-out]" />
      <div className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-6">
        <Dialog.Content {...(description ? {} : { 'aria-describedby': undefined })}
          className={cn(`pointer-events-auto flex max-h-full w-full flex-col overflow-hidden rounded-2xl bg-card
            text-foreground shadow-pop data-[state=open]:animate-[ui-pop-in_180ms_cubic-bezier(0.2,0.9,0.3,1.2)]`,
          size === 'lg' ? 'max-w-3xl' : 'max-w-xl')}>
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-3.5">
            <div className="min-w-0">
              <Dialog.Title className="text-sm font-semibold">{title}</Dialog.Title>
              {description && <Dialog.Description className="mt-0.5 truncate text-xs text-muted-foreground">
                {description}
              </Dialog.Description>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {actions}
              <Dialog.Close asChild>
                <Button variant="ghost" size="icon" aria-label="关闭"><X /></Button>
              </Dialog.Close>
            </div>
          </header>
          <div className="ui-scroll min-h-0 flex-1 overflow-y-auto p-5">{children}</div>
        </Dialog.Content>
      </div>
    </Dialog.Portal>
  </Dialog.Root>;
}
