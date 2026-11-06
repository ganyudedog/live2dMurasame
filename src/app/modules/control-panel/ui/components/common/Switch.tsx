import { Switch as SwitchPrimitive } from 'radix-ui';
import { cn } from './cn';

export function Switch({ checked, onCheckedChange, disabled, size = 'sm', className, ...aria }: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  size?: 'xs' | 'sm';
  className?: string;
  'aria-label'?: string;
}) {
  const small = size === 'xs';
  return <SwitchPrimitive.Root checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} {...aria}
    className={cn(`inline-flex shrink-0 cursor-pointer items-center rounded-full p-0.5 transition-colors
      data-[state=checked]:bg-primary data-[state=unchecked]:bg-foreground/15
      focus-visible:ring-2 focus-visible:ring-primary/35 disabled:cursor-not-allowed disabled:opacity-50`,
    small ? 'h-4 w-7' : 'h-5 w-9', className)}>
    <SwitchPrimitive.Thumb className={cn(`block rounded-full bg-white shadow-sm transition-transform duration-200
      data-[state=unchecked]:translate-x-0`,
    small ? 'size-3 data-[state=checked]:translate-x-3' : 'size-4 data-[state=checked]:translate-x-4')} />
  </SwitchPrimitive.Root>;
}
