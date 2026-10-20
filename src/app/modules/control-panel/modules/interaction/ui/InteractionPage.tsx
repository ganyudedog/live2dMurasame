import { observer } from 'mobx-react-lite';
import { useMemo, useState } from 'react';
import Modal from '../../../ui/components/Modal';
import { motionFile, motionKey, motionLabel, tierOf, WEIGHT_MAX, WEIGHT_TIERS } from '../domain/interaction';
import type { InteractionSettingsService } from '../service/InteractionSettingsService';

const baseName = (motion: PetMotionDescriptor) => motionFile(motion.file);

/** 分布条用固定顺序的色板区分池内动作，卡片上的圆点与之一一对应。 */
const SEGMENT_TONES = ['bg-primary', 'bg-info', 'bg-success', 'bg-warning', 'bg-secondary', 'bg-error', 'bg-accent', 'bg-neutral'];
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

  return <div className="flex h-full min-h-0 flex-col gap-3 overflow-y-auto p-5">
    <header className="flex shrink-0 flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-lg font-semibold">交互设置</h1>
        <p className="mt-0.5 text-xs text-base-content/50">
          选一个点击区域，往它的动作池里加动作。点击模型这个部位时，会按权重随机播放其中一个。
        </p>
      </div>
      {manager.persistState === 'error'
        ? <span className="shrink-0 text-[11px] text-error">保存失败：{manager.persistError}</span>
        : manager.persistState !== 'idle' && (
          <span className="shrink-0 text-[11px] text-base-content/45">
            {manager.persistState === 'saving' ? '正在保存' : '待保存'}
          </span>
        )}
    </header>

    {manager.areas.length === 0
      ? <div className="rounded-box border border-dashed border-base-300 px-4 py-10 text-center text-xs text-base-content/50">
        这个模型没有定义点击区域（HitArea），无法配置交互。
      </div>
      : <>
        {/* 交互区：卡片内分两排，上行标题靠左，下行标签按数量平分宽度 */}
        <section className="shrink-0 rounded-box border border-base-300 bg-base-100" aria-labelledby="hit-area-title">
          <h2 id="hit-area-title" className="border-b border-base-300 px-3 py-2 text-sm font-semibold">交互区</h2>
          <div role="tablist" aria-label="交互区" className="flex items-stretch gap-1 p-1.5">
            {manager.areas.map((entry) => {
              const active = entry.name === manager.activeAreaName;
              const empty = entry.motions.length === 0;
              return <button key={entry.name} type="button" role="tab" aria-selected={active}
                onClick={() => manager.selectArea(entry.name)}
                className={`flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded-field px-2 py-1.5 text-sm
                  transition-all duration-150 active:scale-95
                  ${active ? 'bg-primary text-primary-content shadow-sm' : 'text-base-content/70 hover:bg-base-content/10'}`}>
                <span className="truncate" title={entry.name}>{entry.name}</span>
                <span aria-hidden="true"
                  className={`grid size-5 shrink-0 place-items-center rounded-full text-[11px] tabular-nums
                    ${active ? 'bg-primary-content/20'
                      : empty ? 'bg-warning/20 text-warning' : 'bg-base-content/10 text-base-content/60'}`}>
                  {entry.motions.length}
                </span>
              </button>;
            })}
          </div>
        </section>

        <section aria-labelledby="pool-title"
          className="flex min-h-0 flex-col rounded-box border border-base-300 bg-base-100">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-base-300 px-4 py-2.5">
            <h2 id="pool-title" className="truncate text-sm font-semibold">
              {area ? `${area.name} 的动作池` : '动作池'}
            </h2>
            {area && (
              <div className="ml-auto flex shrink-0 items-center gap-2">
                <button type="button" className="btn btn-outline btn-sm px-4"
                  disabled={!area.motions.length}
                  onClick={() => manager.previewPool(area.name)}>按权重播放一次</button>
                <button type="button" className="btn btn-outline btn-error btn-sm px-4"
                  disabled={!area.motions.length}
                  onClick={() => manager.clearArea(area.name)}>清空</button>
                <button type="button" className="btn btn-primary btn-sm px-4"
                  onClick={() => setLibraryOpen(true)}>＋ 添加动作</button>
              </div>
            )}
          </div>

          {!area
            ? <div className="px-4 py-10 text-center text-xs text-base-content/50">先在上面选一个点击区域。</div>
            : !area.motions.length
              ? <div className="flex flex-col items-start gap-3 px-4 py-8">
                <p className="text-xs text-base-content/55">
                  这个区域还没有动作，点击模型上的 <span className="font-medium text-base-content/80">{area.name}</span> 时不会有任何反应。
                </p>
                <button type="button" className="btn btn-primary btn-sm" onClick={() => setLibraryOpen(true)}>
                  ＋ 从动作库添加
                </button>
              </div>
              : <>
                {/* 播放概率：系统按权重自动换算，合计永远 100%，用户不需要凑数 */}
                <div className="space-y-2 border-b border-base-300 px-3 py-2.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-[11px] text-base-content/45">
                      播放概率 · 由下方频率自动换算（合计恒为 100%）
                    </span>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input type="checkbox" className="toggle toggle-xs" checked={precise}
                        onChange={(event) => setPrecise(event.target.checked)} />
                      <span className="text-[11px] text-base-content/50">精确权重</span>
                    </label>
                  </div>
                  <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-base-content/10"
                    role="img" aria-label={`播放概率：${area.motions.map((motion) => `${manager.labelOf(motion)} ${manager.shareOf(motion)}%`).join('，')}`}>
                    {area.motions.map((motion, index) => {
                      const share = manager.shareOf(motion);
                      if (share <= 0) return null;
                      return <div key={motionKey(motion)} className={`${toneOf(index)} h-full`}
                        style={{ width: `${share}%` }} title={`${manager.labelOf(motion)} ${share}%`} />;
                    })}
                  </div>
                  <div className="flex flex-wrap gap-x-3 gap-y-1">
                    {area.motions.map((motion, index) => (
                      <span key={motionKey(motion)} className="flex min-w-0 items-center gap-1 text-[11px] text-base-content/50">
                        <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${toneOf(index)}`} />
                        <span className="max-w-24 truncate">{manager.labelOf(motion)}</span>
                        <span className="tabular-nums text-base-content/70">{manager.shareOf(motion)}%</span>
                      </span>
                    ))}
                  </div>
                  {total <= 0 && (
                    <p className="text-[11px] text-warning">所有权重都是 0，点击这个区域不会播放任何动作。</p>
                  )}
                </div>

                <div className="grid grid-cols-1 items-start gap-2.5 p-3 sm:grid-cols-2">
                  {area.motions.map((motion, index) => {
                    const label = manager.labelOf(motion);
                    const muted = motion.weight <= 0;
                    return <article key={motionKey(motion)}
                      className={`flex flex-col gap-2 rounded-box border border-base-300 bg-base-100 p-3 transition-opacity
                        ${muted ? 'opacity-60' : ''}`}>
                      <div className="flex items-start justify-between gap-2">
                        <button type="button" onClick={() => manager.previewAssignment(motion)} title="预览这个动作"
                          className="flex min-w-0 items-center gap-1.5 text-left transition-colors hover:text-primary">
                          <span aria-hidden="true" className={`size-2 shrink-0 rounded-full ${toneOf(index)}`} />
                          <span className="truncate text-sm font-medium">{label}</span>
                        </button>
                        <button type="button" className="btn btn-ghost btn-xs shrink-0"
                          aria-label={`移除 ${label}`} title="移除"
                          onClick={() => manager.removeMotion(area.name, motion.group, motion.index)}>✕</button>
                      </div>
                      {/* 标签模式：档位占满整行、均分宽度，右侧只留百分比 */}
                      {!precise && (
                        <div className="flex items-center gap-2">
                          <div role="group" aria-label={`${label} 出现频率`}
                            className="flex min-w-0 flex-1 items-center gap-0.5 rounded-field bg-base-content/5 p-0.5">
                            {WEIGHT_TIERS.map((tier) => {
                              const active = tierOf(motion.weight).id === tier.id;
                              return <button key={tier.id} type="button" aria-pressed={active}
                                className={`min-w-0 flex-1 truncate rounded-[0.4rem] px-1 py-1 text-center text-[11px]
                                  transition-all duration-150 active:scale-95
                                  ${active ? 'bg-primary text-primary-content shadow-sm' : 'text-base-content/60 hover:bg-base-content/10'}`}
                                onClick={() => manager.setWeight(area.name, motion.group, motion.index, tier.value)}>
                                {tier.label}
                              </button>;
                            })}
                          </div>
                          <span className={`w-9 shrink-0 text-center text-[11px] tabular-nums
                            ${muted ? 'text-warning' : 'text-base-content/50'}`}>
                            {muted ? '不播' : `${manager.shareOf(motion)}%`}
                          </span>
                        </div>
                      )}
                      {/* 精准模式：档位让位给拖动条 + 直接填数 */}
                      {precise && (
                        <div className="flex items-center gap-2">
                          <input type="range" min={0} max={WEIGHT_MAX} step={1} value={Math.min(WEIGHT_MAX, motion.weight)}
                            className="range range-xs range-primary min-w-0 flex-1"
                            aria-label={`${label} 权重滑杆`}
                            onChange={(event) => manager.setWeight(area.name, motion.group, motion.index, Number(event.target.value))} />
                          <input type="number" min={0} max={WEIGHT_MAX} step={1} value={motion.weight}
                            className="input input-xs w-14 shrink-0 text-center tabular-nums"
                            aria-label={`${label} 权重`}
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
      <div className="space-y-3">
        <label className="input input-sm flex items-center gap-2">
          <span aria-hidden="true" className="text-base-content/40">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="grow"
            placeholder="搜索分组、文件名或动作说明" aria-label="搜索动作" />
        </label>
        {!groups.length && <p className="py-6 text-center text-xs text-base-content/50">没有匹配的动作</p>}
        {groups.map(([group, motions]) => (
          <section key={group} className="space-y-1.5">
            <h3 className="flex items-center justify-between gap-2 text-xs font-medium text-base-content/60">
              <span className="truncate" title={group}>{group}</span>
              <span className="shrink-0 text-[11px] tabular-nums text-base-content/35">{motions.length}</span>
            </h3>
            <div className="grid gap-1.5 sm:grid-cols-2">
              {motions.map((motion) => {
                const added = assigned.has(motionKey(motion));
                return <div key={motionKey(motion)}
                  className={`flex items-center gap-2 rounded-field border border-base-300 px-2 py-1.5
                    ${added ? 'opacity-60' : 'hover:bg-base-200/60'}`}>
                  <button type="button" disabled={!area} onClick={() => manager.previewMotion(motion)}
                    className="flex min-w-0 flex-1 items-center gap-1.5 text-left text-sm" title="预览">
                    <span aria-hidden="true" className="text-[10px]">▶</span>
                    <span className="truncate">{motionLabel(motion)}</span>
                    <span className="truncate text-[11px] text-base-content/35">{baseName(motion)}</span>
                  </button>
                  <button type="button" className="btn btn-outline btn-xs shrink-0"
                    disabled={!area || added}
                    onClick={() => area && manager.addMotion(area.name, motion)}>
                    {added ? '已添加' : '添加'}
                  </button>
                </div>;
              })}
            </div>
          </section>
        ))}
      </div>
    </Modal>
  </div>;
});

export default InteractionPage;
