import type { ReactNode } from 'react';

/** 设置页统一的卡片：标题行 + 分隔线 + 内容区。 */
export function SettingsCard({ title, description, actions, children }: {
  title: string;
  description?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return <section className="rounded-box border border-base-300 bg-base-100">
    <header className="flex flex-wrap items-center justify-between gap-2 border-b border-base-300 px-3 py-2.5">
      <div className="min-w-0">
        <h2 className="text-sm font-medium">{title}</h2>
        {description ? <p className="mt-0.5 text-[11px] leading-relaxed text-base-content/45">{description}</p> : null}
      </div>
      {actions ? <div className="shrink-0">{actions}</div> : null}
    </header>
    <div className="space-y-3 p-3">{children}</div>
  </section>;
}

/** 标签在上、控件在下；hint 说明这个字段是什么。 */
export function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return <div className="flex min-w-0 flex-col gap-1">
    <span className="text-xs text-base-content/55">{label}</span>
    {children}
    {hint ? <span className="text-[11px] leading-relaxed text-base-content/40">{hint}</span> : null}
  </div>;
}

/** 开关行：左标题右开关，整行可点。 */
export function SwitchRow({ label, hint, checked, onChange }: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return <label className="flex cursor-pointer items-center justify-between gap-3 rounded-field bg-base-content/5 px-3 py-2 transition-colors hover:bg-base-content/10">
    <span className="min-w-0">
      <span className="block text-xs text-base-content/80">{label}</span>
      {hint ? <span className="mt-0.5 block text-[11px] leading-relaxed text-base-content/40">{hint}</span> : null}
    </span>
    <input type="checkbox" className="toggle toggle-sm shrink-0" checked={checked}
      onChange={(event) => onChange(event.target.checked)} />
  </label>;
}
