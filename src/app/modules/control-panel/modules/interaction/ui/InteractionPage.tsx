import { useMemo, useState } from 'react';
import { observer } from 'mobx-react-lite';
import type { InteractionSettingsService } from '../service/InteractionSettingsService';

const InteractionPage = observer(function InteractionPage({ manager }: { manager: InteractionSettingsService }) {
  const [query, setQuery] = useState('');
  const groups = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const filtered = manager.availableMotions.filter((motion) => (
      !normalizedQuery
      || motion.group.toLowerCase().includes(normalizedQuery)
      || motion.file.toLowerCase().includes(normalizedQuery)
      || motion.text?.toLowerCase().includes(normalizedQuery)
    ));
    const grouped = new Map<string, PetMotionDescriptor[]>();
    filtered.forEach((motion) => grouped.set(motion.group, [...(grouped.get(motion.group) ?? []), motion]));
    return Array.from(grouped.entries());
  }, [manager.availableMotions, query]);

  return (
    <div className="p-4 space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-lg font-semibold">交互设置</h1>
        </div>
        <label className="input input-sm input-bordered flex items-center gap-2 w-64 max-w-full">
          <span className="text-base-content/45" aria-hidden="true">⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} className="grow" placeholder="搜索动作" />
        </label>
      </header>

      <section aria-labelledby="motion-library-title">
        <div className="mb-2 flex items-center justify-between">
          <h2 id="motion-library-title" className="text-sm font-semibold">动作库</h2>
          <span className="text-xs text-base-content/50">{manager.availableMotions.length} 个动作</span>
        </div>
        <div className="max-h-72 overflow-y-auto border-y border-base-300 divide-y divide-base-300">
          {groups.length === 0 && <div className="py-8 text-center text-sm text-base-content/45">没有可用动作</div>}
          {groups.map(([group, motions]) => (
            <div key={group} className="grid grid-cols-[7rem_1fr] gap-3 py-3">
              <div className="text-sm font-medium truncate" title={group}>{group}</div>
              <div className="grid gap-1 sm:grid-cols-2">
                {(motions ?? []).map((motion) => {
                  const selectedMotion = manager.selectedMotion;
                  const selected = selectedMotion?.group === motion.group && selectedMotion.index === motion.index;
                  return (
                    <button
                      key={`${motion.group}:${motion.index}`}
                      type="button"
                      className={`min-w-0 border px-3 py-2 text-left transition-colors ${selected ? 'border-primary bg-primary/10' : 'border-base-300 hover:bg-base-200'}`}
                      onClick={() => manager.previewMotion(motion)}
                      title="预览并选中"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm">#{motion.index + 1} {motion.file.split(/[\\/]/).at(-1) || motion.file}</span>
                        <span className="shrink-0 text-xs text-primary">▶</span>
                      </span>
                      {motion.text && <span className="mt-1 block truncate text-xs text-base-content/55">{motion.text}</span>}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="hit-area-title">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="hit-area-title" className="text-sm font-semibold">点击区域</h2>
          <span className="text-xs text-base-content/55">
            {manager.selectedMotion ? `已选：${manager.selectedMotion.group} #${manager.selectedMotion.index + 1}` : '未选择动作'}
          </span>
        </div>
        <div className="space-y-3">
          {manager.areas.length === 0 && <div className="border-y border-base-300 py-8 text-center text-sm text-base-content/45">模型没有定义 HitArea</div>}
          {manager.areas.map((area) => (
            <article key={area.name} className="border border-base-300 p-3">
              <div className="flex items-center justify-between gap-3">
                <h3 className="min-w-0 truncate text-sm font-semibold" title={area.name}>{area.name}</h3>
                <button
                  type="button"
                  className="btn btn-sm btn-primary"
                  disabled={!manager.selectedMotion || area.motions.some((item) => item.group === manager.selectedMotion?.group && item.index === manager.selectedMotion?.index)}
                  onClick={() => manager.assignSelectedMotion(area.name)}
                >
                  ＋ 分配所选动作
                </button>
              </div>
              <div className="mt-3 divide-y divide-base-300 border-t border-base-300">
                {area.motions.length === 0 && <div className="py-3 text-xs text-base-content/45">点击此区域时不播放动作</div>}
                {area.motions.map((motion) => (
                  <div key={`${motion.group}:${motion.index}`} className="grid grid-cols-[minmax(0,1fr)_7rem_2.5rem] items-center gap-3 py-2">
                    <button type="button" className="min-w-0 truncate text-left text-sm hover:text-primary" onClick={() => manager.previewMotion({ ...motion, file: '' })} title="预览动作">
                      ▶ {motion.group} #{motion.index + 1}
                    </button>
                    <label className="flex items-center gap-2 text-xs text-base-content/55">
                      权重
                      <input
                        type="number"
                        min="0"
                        step="1"
                        className="input input-xs input-bordered w-16"
                        value={motion.weight}
                        onChange={(event) => manager.setWeight(area.name, motion.group, motion.index, Number(event.target.value))}
                      />
                    </label>
                    <button type="button" className="btn btn-xs btn-ghost text-error" title="移除" onClick={() => manager.removeMotion(area.name, motion.group, motion.index)}>×</button>
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
        {manager.persistState === 'saving' && <p className="mt-2 text-xs text-base-content/50">正在保存</p>}
        {manager.persistState === 'error' && <p className="mt-2 text-xs text-error">保存失败：{manager.persistError}</p>}
      </section>
    </div>
  );
});

export default InteractionPage;
