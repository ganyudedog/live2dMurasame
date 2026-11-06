import type { InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { ChevronDown } from 'lucide-react';
import { cn } from './cn';

const fieldBase = `w-full min-w-0 rounded-lg border border-input bg-card text-foreground transition-colors
  placeholder:text-muted-foreground/60 hover:border-foreground/25 focus:border-primary/60
  disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60 aria-invalid:border-danger/70`;

const inputSizes = {
  xs: 'h-6 px-1.5 text-[11px]',
  sm: 'h-8 px-2.5 text-xs',
} as const;

type InputProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'size'> & { size?: keyof typeof inputSizes };

export function Input({ className, size = 'sm', type = 'text', ...props }: InputProps) {
  return <input type={type}
    className={cn(fieldBase, inputSizes[size], type === 'number' && 'ui-number tabular-nums', className)} {...props} />;
}

type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> & { size?: keyof typeof inputSizes };

/** 原生 select 保留系统下拉与键盘行为，只替换外观与箭头。 */
export function Select({ className, size = 'sm', children, ...props }: SelectProps) {
  return <span className={cn('relative block min-w-0', className)}>
    <select className={cn(fieldBase, inputSizes[size], 'cursor-pointer appearance-none pr-7')} {...props}>
      {children}
    </select>
    <ChevronDown aria-hidden="true"
      className="pointer-events-none absolute top-1/2 right-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
  </span>;
}

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea
    className={cn(fieldBase, 'ui-scroll px-2.5 py-2 text-xs leading-relaxed', className)} {...props} />;
}
