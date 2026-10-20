import { describe, expect, it, vi } from 'vitest';
import type { LogService } from '@app/shared/logging/LogService';
import { InteractionSettingsService } from '../service/InteractionSettingsService';
import { motionLabel, pickWeighted, sharePercent, tierOf, WEIGHT_TIERS, type InteractionCommit } from '../domain/interaction';

const view: PetModelInteractionView = {
  motions: [
    { group: 'TapHead', index: 0, file: 'tap-0.motion3.json' },
    { group: 'TapHead', index: 1, file: 'tap-1.motion3.json' },
  ],
  hitAreas: [
    { name: 'Head', motions: [{ group: 'TapHead', index: 0, weight: 100 }] },
    { name: 'Body', motions: [] },
  ],
};

describe('InteractionSettingsService', () => {
  it('persists a complete binding map after the first user edit', async () => {
    let commit: InteractionCommit | null = null;
    const manager = new InteractionSettingsService({
      persist: async (next) => { commit = next; },
      preview: vi.fn(),
      log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as LogService,
      debounceMs: 0,
    });
    manager.syncFromView('model-a', view);
    manager.selectMotion(view.motions[1]);
    manager.assignSelectedMotion('Body');
    await manager.flush();

    expect(commit).toEqual({
      modelPath: 'model-a',
      interaction: {
        Head: [{ group: 'TapHead', index: 0, weight: 100 }],
        Body: [{ group: 'TapHead', index: 1, weight: 100 }],
      },
    });
  });

  it('previews the exact selected group and index', () => {
    const preview = vi.fn();
    const manager = new InteractionSettingsService({
      persist: vi.fn(async () => {}),
      preview,
      log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as LogService,
    });
    manager.syncFromView('model-a', view);
    manager.previewMotion(view.motions[1]);
    expect(preview).toHaveBeenCalledWith(view.motions[1]);
    expect(manager.selectedMotion).toEqual(view.motions[1]);
  });

  it('defaults the edited area to the first hit area and adds motions into its pool', async () => {
    const manager = new InteractionSettingsService({
      persist: vi.fn(async () => {}),
      preview: vi.fn(),
      log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as LogService,
      debounceMs: 0,
    });
    manager.syncFromView('model-a', view);
    expect(manager.activeAreaName).toBe('Head');
    expect(manager.configuredAreaCount).toBe(1);

    manager.selectArea('Body');
    manager.addMotion('Body', view.motions[0]);
    expect(manager.activeArea?.name).toBe('Body');
    expect(manager.activeArea?.motions).toEqual([{ group: 'TapHead', index: 0, weight: 100 }]);
    expect(manager.configuredAreaCount).toBe(2);

    // 同一个动作重复加入不会产生重复项。
    manager.addMotion('Body', view.motions[0]);
    expect(manager.activeArea?.motions).toHaveLength(1);

    manager.clearArea('Body');
    expect(manager.activeArea?.motions).toEqual([]);
  });

  it('previews a weighted pick from the pool like the runtime does', () => {
    const preview = vi.fn();
    const manager = new InteractionSettingsService({
      persist: vi.fn(async () => {}),
      preview,
      log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as LogService,
      debounceMs: 0,
    });
    manager.syncFromView('model-a', {
      motions: view.motions,
      hitAreas: [{ name: 'Head', motions: [{ group: 'TapHead', index: 0, weight: 1 }, { group: 'TapHead', index: 1, weight: 9 }] }],
    });
    manager.previewPool('Head', 0.5);
    expect(preview).toHaveBeenLastCalledWith(view.motions[1]);
    manager.previewPool('Head', 0.05);
    expect(preview).toHaveBeenLastCalledWith(view.motions[0]);
  });
});

describe('interaction domain helpers', () => {
  it('reads weights as shares of the pool and picks by weight', () => {
    const pool = [{ group: 'A', index: 0, weight: 1 }, { group: 'B', index: 0, weight: 3 }];
    expect(sharePercent(pool, pool[1])).toBe(75);
    expect(sharePercent(pool, { group: 'missing', index: 0 })).toBe(0);
    expect(pickWeighted(pool, 0)).toEqual(pool[0]);
    expect(pickWeighted(pool, 0.99)).toEqual(pool[1]);
    expect(pickWeighted([], 0.5)).toBeNull();
    expect(pickWeighted([{ group: 'A', index: 0, weight: 0 }], 0.5)).toBeNull();
    // 有说明时用说明做显示名，否则退回分组 + 序号。
    expect(motionLabel({ group: 'TapHead', index: 1, text: '点头' })).toBe('点头');
    expect(motionLabel({ group: 'TapHead', index: 1 })).toBe('TapHead #2');
  });

  it('derives shares purely from ratios, whatever the weights add up to', () => {
    // 权重是相对大小，不需要凑成 100。
    const pool = [{ group: 'A', index: 0, weight: 200 }, { group: 'B', index: 0, weight: 100 }];
    expect(pool.map((motion) => sharePercent(pool, motion))).toEqual([67, 33]);
    expect(pool.map((motion) => sharePercent(pool, motion)).reduce((sum, share) => sum + share, 0)).toBe(100);
  });

  it('maps a weight to the tier whose range contains it', () => {
    // 0-25 很少 / 26-50 有时 / 51-75 经常 / 76-100 频繁。
    expect(tierOf(0).label).toBe('很少');
    expect(tierOf(25).label).toBe('很少');
    expect(tierOf(26).label).toBe('有时');
    expect(tierOf(50).label).toBe('有时');
    expect(tierOf(51).label).toBe('经常');
    expect(tierOf(75).label).toBe('经常');
    expect(tierOf(76).label).toBe('频繁');
    expect(tierOf(100).label).toBe('频繁');
    // 历史数据里超过上限的值也不会掉出档位。
    expect(tierOf(500).label).toBe('频繁');
    // 点档位写入的值正好落在该档区间内，点完仍然亮着自己。
    for (const tier of WEIGHT_TIERS) expect(tierOf(tier.value).id).toBe(tier.id);
  });

  it('offers frequency tiers that only change the edited entry', () => {
    const manager = new InteractionSettingsService({
      persist: vi.fn(async () => {}),
      preview: vi.fn(),
      log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as LogService,
      debounceMs: 0,
    });
    manager.syncFromView('model-a', {
      motions: view.motions,
      hitAreas: [{ name: 'Head', motions: [
        { group: 'A', index: 0, weight: 100 }, { group: 'B', index: 0, weight: 100 },
      ] }],
    });
    manager.setWeight('Head', 'A', 0, 75);
    // B 的权重丝毫未动。
    expect(manager.activeArea?.motions.map((motion) => motion.weight)).toEqual([75, 100]);
    // 权重上限是 100，超出部分被夹住。
    manager.setWeight('Head', 'A', 0, 250);
    expect(manager.activeArea?.motions[0].weight).toBe(100);
  });

  it('keeps every weight exactly as set, and lets the derived share follow', () => {
    // 需求场景：B=40 就要是 40，随后 A=50、C=10 也不会把 B 挤回去。
    const manager = new InteractionSettingsService({
      persist: vi.fn(async () => {}),
      preview: vi.fn(),
      log: { debug: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as LogService,
      debounceMs: 0,
    });
    manager.syncFromView('model-a', {
      motions: view.motions,
      hitAreas: [{ name: 'Head', motions: [
        { group: 'A', index: 0, weight: 100 }, { group: 'B', index: 0, weight: 100 }, { group: 'C', index: 0, weight: 100 },
      ] }],
    });
    manager.setWeight('Head', 'B', 0, 40);
    manager.setWeight('Head', 'A', 0, 50);
    manager.setWeight('Head', 'C', 0, 10);
    // 每条都按用户输入原样保留，没有任何自动回退。
    expect(manager.activeArea?.motions.map((motion) => motion.weight)).toEqual([50, 40, 10]);
    // 占比是派生结果：合计 100 时权重就是百分比。
    expect(manager.activeArea?.motions.map((motion) => manager.shareOf(motion))).toEqual([50, 40, 10]);
  });
});
