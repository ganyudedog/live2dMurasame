import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import { Eraser, MousePointerClick, Play, Plus, Search, Shuffle, X } from 'lucide-react';
import Modal from '../components/common/Modal';
import { Page } from '../components/common/Page';
import { Button } from '../components/common/Button';
import { Input } from '../components/common/FormControls';
import { Switch } from '../components/common/Switch';
import { StatusDot } from '../components/common/Badge';
import { EmptyState } from '../components/common/Feedback';
import { SegmentedTabs } from '../components/common/SegmentedTabs';
import { cn } from '../components/common/cn';
import { motionFile, motionKey, motionLabel, tierOf, WEIGHT_MAX, WEIGHT_TIERS } from '../../modules/interaction/domain/interaction';
import type { InteractionSettingsService } from '../../modules/interaction/service/InteractionSettingsService';

const baseName = (motion: PetMotionDescriptor) => motionFile(motion.file);

/** 分布条用固定顺序的色板区分池内动作，卡片上的圆点与之一一对应。 */
const SEGMENT_TONES = ['bg-primary', 'bg-sky-500', 'bg-amber-500', 'bg-accent', 'bg-teal-500', 'bg-emerald-500', 'bg-orange-500', 'bg-slate-500'];
const toneOf = (index: number) => SEGMENT_TONES[index % SEGMENT_TONES.length] ?? SEGMENT_TONES[0];

const InteractionPage = observer(function InteractionPage({ manager }: { manager: InteractionSettingsService }) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [precise, setPrecise] = useState(false);
  const area = manager.activeArea;
  const assigned = new Set((area?.motions ?? []).map((motion) => motionKey(motion)));
  const total = (area?.motions ?? []).reduce((sum, motion) => sum + Math.max(0, motion.weight), 0);
  const groups = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    const filtered = manager.availableMotions.filter((motion) => !keyword
      || motion.group.toLowerCase().includes(keyword)
      || baseName(motion).toLowerCase().includes(keyword)
      || motion.text?.toLowerCase().includes(keyword));
    const grouped = new Map<string, PetMotionDescriptor[]>();
    for (const motion of filtered) grouped.set(motion.group, [...(grouped.get(motion.group) ?? []), motion]);
    return [...grouped.entries()];
  }, [manager.availableMotions, query]);

  const persistMeta = manager.persistState === 'error'
    ? <span role="alert" className="text-[11px] text-danger">保存失败：{manager.persistError}</span>
    : manager.persistState !== 'idle'
      ? <StatusDot tone="warning" pulse>{manager.persistState === 'saving' ? '正在保存' : '待保存'}</StatusDot>
      : null;

  return <Page title="交互设置" meta={persistMeta}
    description="选一个点击区域，往它的动作池里加动作。点击模型这个部位时，会按权重随机播放其中一个。">
    {manager.areas.length === 0
      ? <EmptyState icon={<MousePointerClick />} title="没有可配置的点击区域">
        这个模型没有定义点击区域（HitArea），无法配置交互。
      </EmptyState>
      : <>
        <section aria-labelledby="hit-area-title" className="space-y-2">
          <h2 id="hit-area-title" className="px-0.5 text-xs font-medium text-muted-foreground">交互区</h2>
          <SegmentedTabs label="交互区" value={manager.activeAreaName}
            onChange={(name) => manager.selectArea(name)}
            items={manager.areas.map((entry) => ({
              key: entry.name, label: entry.name, count: entry.motions.length, warn: entry.motions.length === 0,
            }))} />
        </section>

        <section aria-labelledby="pool-title" className="flex min-h-0 flex-col rounded-xl bg-card shadow-card">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
            <h2 id="pool-title" className="truncate text-[13px] font-semibold">
              {area ? `${area.name} 的动作池` : '动作池'}
            </h2>
            {area && (
              <div className="ml-auto flex shrink-0 items-center gap-1.5">
                <Button variant="ghost" disabled={!area.motions.length}
                  onClick={() => manager.previewPool(area.name)}><Shuffle />按权重播放一次</Button>
                <Button variant="danger" disabled={!area.motions.length}
                  onClick={() => manager.clearArea(area.name)}><Eraser />清空</Button>
                <Button variant="primary" onClick={() => setLibraryOpen(true)}><Plus />添加动作</Button>
              </div>
            )}
          </div>

          {!area
            ? <div className="px-4 py-10 text-center text-xs text-muted-foreground">先在上面选一个点击区域。</div>
            : !area.motions.length
              ? <EmptyState className="m-4" icon={<MousePointerClick />} title="这个区域还没有动作">
                <p>点击模型上的 <span className="font-medium text-foreground">{area.name}</span> 时不会有任何反应。</p>
                <Button variant="primary" className="mt-3" onClick={() => setLibraryOpen(true)}>
                  <Plus />从动作库添加
                </Button>
              </EmptyState>
              : <>
                {/* 播放概率：系统按权重自动换算，合计永远 100%，用户不需要凑数 */}
                <div className="space-y-2.5 border-b border-border px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-muted-foreground">
                      播放概率 · 由下方频率自动换算（合计恒为 100%）
                    </span>
                    <label className="flex cursor-pointer items-center gap-2">
                      <span className="text-[11px] text-muted-foreground">精确权重</span>
                      <Switch size="xs" checked={precise} onCheckedChange={setPrecise} aria-label="精确权重" />
                    </label>
                  </div>
                  <div className="flex h-2 w-full gap-0.5 overflow-hidden rounded-full bg-foreground/8"
                    role="img" aria-label={`播放概率：${area.motions.map((motion) => `${manager.labelOf(motion)} ${manager.shareOf(motion)}%`).join('，')}`}>
                    {area.motions.map((motion, index) => {
                      const share = manager.shareOf(motion);
                      if (share <= 0) return null;
                      return <div key={motionKey(motion)} className={cn(toneOf(index), 'h-full transition-[width] duration-300')}
                        style={{ width: `${share}%` }} title={`${manager.labelOf(motion)} ${share}%`} />;
                    })}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {area.motions.map((motion, index) => (
                      <span key={motionKey(motion)} className="flex min-w-0 items-center gap-1 text-[11px] text-muted-foreground">
                        <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', toneOf(index))} />
                        <span className="max-w-24 truncate">{manager.labelOf(motion)}</span>
                        <span className="tabular-nums text-foreground/80">{manager.shareOf(motion)}%</span>
                      </span>
                    ))}
                  </div>
                  {total <= 0 && (
                    <p className="text-[11px] text-warning">所有权重都是 0，点击这个区域不会播放任何动作。</p>
                  )}
                </div>

                <div className="grid grid-cols-1 items-start gap-3 p-4 sm:grid-cols-2">
                  {area.motions.map((motion, index) => {
                    const label = manager.labelOf(motion);
                    const muted = motion.weight <= 0;
                    return <article key={motionKey(motion)}
                      className={cn('flex flex-col gap-2.5 rounded-lg border border-border p-3 transition-opacity',
                        muted && 'opacity-60')}>
                      <div className="flex items-center justify-between gap-2">
                        <button type="button" onClick={() => manager.previewAssignment(motion)} title="预览这个动作"
                          className="group flex min-w-0 cursor-pointer items-center gap-2 text-left transition-colors hover:text-primary">
                          <span aria-hidden="true" className={cn('size-2 shrink-0 rounded-full', toneOf(index))} />
                          <span className="truncate text-[13px] font-medium">{label}</span>
                          <Play aria-hidden="true" className="size-3 shrink-0 opacity-0 transition-opacity group-hover:opacity-100" />
                        </button>
                        <Button variant="ghost" size="icon-xs" aria-label={`移除 ${label}`} title="移除"
                          onClick={() => manager.removeMotion(area.name, motion.group, motion.index)}><X /></Button>
                      </div>
                      {/* 标签模式：档位占满整行、均分宽度，右侧只留百分比 */}
                      {!precise && (
                        <div className="flex items-center gap-2">
                          <div role="group" aria-label={`${label} 出现频率`}
                            className="flex min-w-0 flex-1 items-center gap-0.5 rounded-lg bg-muted p-0.5">
                            {WEIGHT_TIERS.map((tier) => {
                              const active = tierOf(motion.weight).id === tier.id;
                              return <button key={tier.id} type="button" aria-pressed={active}
                                className={cn(`min-w-0 flex-1 cursor-pointer truncate rounded-md px-1 py-1 text-center text-[11px]
                                  transition-all duration-150 active:scale-95`,
                                active ? 'bg-card font-medium text-primary shadow-card' : 'text-muted-foreground hover:text-foreground')}
                                onClick={() => manager.setWeight(area.name, motion.group, motion.index, tier.value)}>
                                {tier.label}
                              </button>;
                            })}
                          </div>
                          <span className={cn('w-9 shrink-0 text-center text-[11px] tabular-nums',
                            muted ? 'text-warning' : 'text-muted-foreground')}>
                            {muted ? '不播' : `${manager.shareOf(motion)}%`}
                          </span>
                        </div>
                      )}
                      {/* 精准模式：档位让位给拖动条 + 直接填数 */}
                      {precise && (
                        <div className="flex items-center gap-2">
                          <input type="range" min={0} max={WEIGHT_MAX} step={1} value={Math.min(WEIGHT_MAX, motion.weight)}
                            className="ui-range min-w-0 flex-1"
                            aria-label={`${label} 权重滑杆`}
                            onChange={(event) => manager.setWeight(area.name, motion.group, motion.index, Number(event.target.value))} />
                          <Input type="number" size="xs" min={0} max={WEIGHT_MAX} step={1} value={motion.weight}
                            className="w-12 text-center" aria-label={`${label} 权重`}
                            onChange={(event) => manager.setWeight(area.name, motion.group, motion.index, Number(event.target.value))} />
                        </div>
                      )}
                    </article>;
                  })}
                </div>
              </>}
        </section>
      </>}

    <Modal open={libraryOpen} onClose={() => setLibraryOpen(false)} size="lg"
      title="动作库"
      description={area ? `把动作加进「${area.name}」的动作池 · 点击名称先预览` : '先在上面选一个点击区域'}>
      <div className="space-y-4">
        <label className="relative block">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input value={query} onChange={(event) => setQuery(event.target.value)} className="pl-8"
            placeholder="搜索分组、文件名或动作说明" aria-label="搜索动作" />
        </label>
        {!groups.length && <p className="py-6 text-center text-xs text-muted-foreground">没有匹配的动作</p>}
        {groups.map(([group, motions]) => (
          <section key={group} className="space-y-2">
            <h3 className="flex items-center justify-between gap-2 text-xs font-medium text-muted-foreground">
              <span className="truncate" title={group}>{group}</span>
              <span className="shrink-0 rounded-full bg-muted px-1.5 text-[10px] tabular-nums">{motions.length}</span>
            </h3>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {motions.map((motion) => {
                const added = assigned.has(motionKey(motion));
                return <div key={motionKey(motion)}
                  className={cn('flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 transition-colors',
                    added ? 'bg-muted/50' : 'hover:bg-muted/60')}>
                  <button type="button" disabled={!area} onClick={() => manager.previewMotion(motion)}
                    className="flex min-w-0 flex-1 cursor-pointer items-center gap-2 text-left text-[13px] disabled:cursor-not-allowed" title="预览">
                    <Play aria-hidden="true" className="size-3 shrink-0 text-primary" />
                    <span className="truncate">{motionLabel(motion)}</span>
                    <span className="truncate font-mono text-[10px] text-muted-foreground/70">{baseName(motion)}</span>
                  </button>
                  <Button size="xs" variant={added ? 'ghost' : 'outline'}
                    disabled={!area || added}
                    onClick={() => area && manager.addMotion(area.name, motion)}>
                    {added ? '已添加' : <><Plus />添加</>}
                  </Button>
                </div>;
              })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  </Page>;
});

export default InteractionPage;
