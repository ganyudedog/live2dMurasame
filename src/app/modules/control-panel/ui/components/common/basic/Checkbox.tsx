import { Checkbox as CheckboxPrimitive } from 'radix-ui';
import { Check } from 'lucide-react';
import { cn } from './cn';

export function Checkbox({ checked, onCheckedChange, disabled, className, ...aria }: {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  disabled?: boolean;
  className?: string;
  'aria-label'?: string;
}) {
  return <CheckboxPrimitive.Root checked={checked} disabled={disabled} {...aria}
    onCheckedChange={(value) => onCheckedChange(value === true)}
    className={cn(`grid size-4 shrink-0 cursor-pointer place-items-center rounded-[5px] border border-input bg-card
      transition-colors hover:border-foreground/30 data-[state=checked]:border-primary data-[state=checked]:bg-primary
      data-[state=checked]:text-primary-foreground focus-visible:ring-2 focus-visible:ring-primary/35
      disabled:cursor-not-allowed disabled:opacity-50`, className)}>
    <CheckboxPrimitive.Indicator>
      <Check className="size-3" strokeWidth={3} aria-hidden="true" />
    </CheckboxPrimitive.Indicator>
  </CheckboxPrimitive.Root>;
}
