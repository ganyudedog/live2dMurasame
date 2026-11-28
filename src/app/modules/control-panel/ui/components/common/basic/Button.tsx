import { cva, type VariantProps } from 'class-variance-authority';
import type { ButtonHTMLAttributes } from 'react';
import { cn } from './cn';

const buttonVariants = cva(
  `inline-flex shrink-0 cursor-pointer select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg
   font-medium transition-[background-color,color,box-shadow,transform] duration-150 active:scale-[0.97]
   focus-visible:ring-2 focus-visible:ring-primary/35
   disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0`,
  {
    variants: {
      variant: {
        primary: 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90',
        outline: 'bg-card text-foreground shadow-card hover:bg-muted',
        soft: 'bg-muted text-foreground hover:bg-foreground/10',
        ghost: 'text-muted-foreground hover:bg-muted hover:text-foreground',
        danger: 'text-danger hover:bg-danger/10',
        'danger-solid': 'bg-danger text-white shadow-sm hover:bg-danger/90',
      },
      size: {
        xs: 'h-6 px-2 text-[11px]',
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3 text-[13px]',
        icon: 'size-7 [&_svg]:size-4',
        'icon-xs': 'size-6 rounded-md',
      },
    },
    defaultVariants: { variant: 'outline', size: 'sm' },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonVariants>;

/** 统一按钮；默认 type="button"，避免放进表单时意外提交。 */
export function Button({ className, variant, size, type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
