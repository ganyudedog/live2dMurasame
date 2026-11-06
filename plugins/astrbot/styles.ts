/**
 * 插件只依赖宿主的 Tailwind 主题令牌（bg-card、border-input、text-muted-foreground…），
 * 不引用应用内部的组件实现，所以控件外观在这里用工具类组合。
 */
const FIELD = `rounded-lg border border-input bg-card text-foreground transition-colors placeholder:text-muted-foreground/60
  hover:border-foreground/25 focus:border-primary/60 disabled:cursor-not-allowed disabled:bg-muted disabled:opacity-60
  aria-invalid:border-danger/70`;

export const INPUT = `${FIELD} h-8 min-w-0 px-2.5 text-xs`;
export const SELECT = `${FIELD} h-8 min-w-0 cursor-pointer px-2 text-xs`;
export const TEXTAREA = `${FIELD} px-2.5 py-2 text-xs leading-relaxed`;

const BUTTON_BASE = `inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 whitespace-nowrap rounded-lg
  font-medium transition-colors active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50`;

export const BUTTON = `${BUTTON_BASE} h-8 bg-card px-3 text-xs text-foreground shadow-card hover:bg-muted`;
export const GHOST_BUTTON = `${BUTTON_BASE} h-7 px-2.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground`;
export const GHOST_BUTTON_XS = `${BUTTON_BASE} h-6 px-2 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground`;
export const LABEL = 'text-xs font-medium text-foreground/80';
export const HINT = 'text-[11px] leading-snug text-muted-foreground';
