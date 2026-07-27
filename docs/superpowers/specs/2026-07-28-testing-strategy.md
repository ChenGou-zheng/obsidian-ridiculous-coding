# 测试策略：将"体感好/坏"量化为可验证断言

## 核心思路

这个项目的输出主要是视觉/听觉效果，确实很难像后端 API 一样用 "输入 X → 输出 Y" 模式测试。但"体感好"可以拆解为若干**可度量的子属性**：

```
"体感好"
  ├── 音效节奏感 ──── pitch 计算正确、timer 行为正确
  ├── 动画流畅感 ──── 帧刷新循环不泄漏、TTL 正确、MAX_TRAIL 生效
  ├── 数据正确性 ──── XP/等级计算无边界 bug、持久化往返无损
  ├── 状态一致性 ──── 设定切换后所有服务状态同步
  └── 不崩溃/不泄漏 ── timer 清理、AudioContext 正确关闭
```

每一项都有纯逻辑可测。**策略**：把纯计算从 side-effect（DOM/音频/动画）中抽出为独立纯函数，对它们做单元测试。side-effect 部分做集成/行为测试（mock 外部依赖）。

---

## 一、测试基础设施

### 1.1 技术选型

推荐 **Vitest**（与 TypeScript + esbuild 生态接近，速度快）：

```json
// package.json 新增
{
  "devDependencies": {
    "vitest": "^1.0.0",
    "@vitest/ui": "^1.0.0"
  },
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

### 1.2 文件结构

```
src/
├── main.ts
├── EffectManager.ts
├── ...
└── __tests__/
    ├── pitch.test.ts          # 任务1: pitch 计算 + timer 行为
    ├── xp.test.ts             # XP/等级计算 (已有 XPService 可测)
    ├── shake.test.ts          # 任务2: shake decay 计算
    ├── trail.test.ts          # 任务3: trail 生命周期 (纯数据层)
    ├── sprite.test.ts         # 任务4: tscn 解析
    ├── sanitize.test.ts       # 字符标签映射
    ├── color.test.ts          # 随机颜色生成属性
    ├── audio.test.ts          # AudioService (mock Web Audio API)
    └── integration.test.ts    # 端到端: 设定传播、服务联动
```

### 1.3 重构前置步骤：抽出纯函数

当前代码将计算逻辑混在方法内部，需要先做**最小重构**才能测试。对于每个模块：

| 模块 | 当前问题 | 重构动作 |
|------|---------|---------|
| `main.ts` pitch | 逻辑写死在回调里 | 抽为 `computePitch(increase: number): number` |
| `EffectManager.ts` shake | `triggerShake` 难以单独测试 | 抽 `computeShakeEnd(now, currentEnd, extendMs, maxTotalMs)` |
| `XPService.ts` level-up | 有 persist side-effect | 已有纯 `addXp` + `progress` getter，基本可测 |
| `EffectManager.ts` trail | 混杂 Decorations + setTimeout | 抽 `computeTrailState(items, ttl, now)` 返回纯数据 |

重构量很小（每个 5-10 行提取），但**必须比写测试先做**。

---

## 二、按任务的测试用例

### 任务 1: 动态 Pitch 递增

#### 纯函数 — `computePitch(increase: number): number`

```typescript
// 提取自 VS Code extension.ts:188
export function computePitch(increase: number): number {
  return 1.0 + Math.min(20, increase) * 0.05;
}
```

```typescript
// pitch.test.ts
describe('computePitch', () => {
  it('pitch=1.0 when not typing', () => {
    expect(computePitch(0)).toBe(1.0);
  });
  it('pitch=1.05 after 1 keystroke', () => {
    expect(computePitch(1)).toBeCloseTo(1.05);
  });
  it('pitch=2.0 when capped at 20', () => {
    expect(computePitch(20)).toBeCloseTo(2.0);
  });
  it('pitch stays at 2.0 beyond cap', () => {
    expect(computePitch(21)).toBeCloseTo(2.0);
    expect(computePitch(100)).toBeCloseTo(2.0);
  });
  it('pitch scales linearly', () => {
    expect(computePitch(10)).toBeCloseTo(1.5);
  });
});
```

#### Timer 行为 — 集成测试（fake timers）

```typescript
describe('pitch reset timer', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('resets pitchIncrease after 180ms idle', () => {
    const tracker = new PitchTracker();
    tracker.onKeystroke(); // increase=1
    expect(tracker.getPitch()).toBeCloseTo(1.05);

    vi.advanceTimersByTime(179);
    expect(tracker.getPitch()).toBeCloseTo(1.05); // not reset yet

    vi.advanceTimersByTime(1);
    expect(tracker.getPitch()).toBeCloseTo(1.0); // reset
  });

  it('continues counting without reset when typing fast', () => {
    const tracker = new PitchTracker();
    tracker.onKeystroke(); // 1
    vi.advanceTimersByTime(50);
    tracker.onKeystroke(); // 2 (timer reset to 180)
    vi.advanceTimersByTime(50);
    tracker.onKeystroke(); // 3
    expect(tracker.getPitch()).toBeCloseTo(1.15);
  });
});
```

> `PitchTracker` 是新抽出的类，封装 `pitchIncrease`、`pitchResetTimer`、`computePitch`、`onKeystroke()`。

---

### 任务 2: shakeDecayMs

#### 纯函数 — shake 结束时间计算

```typescript
// shake.test.ts
export function computeShakeEnd(
  now: number,
  currentEnd: number,
  extendMs: number,
  maxTotalMs: number,
  shakeStartAt: number | undefined
): { endAt: number; startAt: number } {
  const startAt = shakeStartAt ?? now;
  const cap = startAt + maxTotalMs;
  const endAt = Math.min(Math.max(currentEnd, now + extendMs), cap);
  return { endAt, startAt };
}

describe('computeShakeEnd', () => {
  it('extends shake duration by decayMs', () => {
    const { endAt } = computeShakeEnd(1000, 0, 120, 400, undefined);
    expect(endAt).toBe(1120);
  });

  it('caps total shake at 400ms', () => {
    const { endAt } = computeShakeEnd(1000, 0, 120, 400, 900);
    expect(endAt).toBeLessThanOrEqual(900 + 400);
  });

  it('anchors cap to start time, not current call', () => {
    const r1 = computeShakeEnd(1000, 0, 120, 400, undefined);
    // second call 50ms later with same startAt from r1
    const r2 = computeShakeEnd(1050, r1.endAt, 120, 400, r1.startAt);
    expect(r2.endAt).toBeLessThanOrEqual(r1.startAt + 400);
  });
});
```

---

### 任务 3: Combo Trail 帧刷新

#### 纯函数 — 装饰项 transform 计算

```typescript
// trail.test.ts
export function computeTrailTransform(
  age: number, 
  ttl: number, 
  floatEm: number = 0.7, 
  scaleAdd: number = 0.6
): { y: number; scale: number } {
  const p = Math.max(0, Math.min(1, age / ttl));
  const y = -(1.1 + floatEm * p);
  const scale = 1.6 + scaleAdd * p;
  return { y, scale };
}

describe('computeTrailTransform', () => {
  it('starts at bottom position with base scale', () => {
    const { y, scale } = computeTrailTransform(0, 400);
    expect(y).toBeCloseTo(-1.1);
    expect(scale).toBeCloseTo(1.6);
  });

  it('ends at top position with increased scale', () => {
    const { y, scale } = computeTrailTransform(400, 400);
    expect(y).toBeCloseTo(-1.8);     // -(1.1 + 0.7 * 1.0)
    expect(scale).toBeCloseTo(2.2);  // 1.6 + 0.6 * 1.0
  });

  it('at 50% ttl, transforms are midpoint', () => {
    const { y, scale } = computeTrailTransform(200, 400);
    expect(y).toBeCloseTo(-1.45);     // -(1.1 + 0.7 * 0.5)
    expect(scale).toBeCloseTo(1.9);   // 1.6 + 0.6 * 0.5
  });

  it('clamps progress at 1.0 for expired items', () => {
    const { y, scale } = computeTrailTransform(800, 400);
    expect(y).toBeCloseTo(-1.8);
    expect(scale).toBeCloseTo(2.2);
  });
});
```

#### Trail 生命周期 — 纯数据层

```typescript
describe('trail lifecycle', () => {
  it('oldest item removed when exceeding MAX_TRAIL', () => {
    const buffer = new TrailBuffer(5, 400); // maxTrail=5, ttl=400
    for (let i = 0; i < 6; i++) {
      buffer.push({ id: i, createdAt: Date.now() });
    }
    expect(buffer.items.length).toBe(5);
    expect(buffer.items[0].id).toBe(1); // id=0 removed
    expect(buffer.items[4].id).toBe(5);
  });

  it('expired items filtered out on cleanup', () => {
    const now = Date.now();
    const buffer = new TrailBuffer(5, 400);
    buffer.push({ id: 1, createdAt: now - 500 }); // expired
    buffer.push({ id: 2, createdAt: now - 100 }); // alive
    buffer.cleanup(now);
    expect(buffer.items.length).toBe(1);
    expect(buffer.items[0].id).toBe(2);
  });

  it('animation loop active only while items exist', () => {
    const buffer = new TrailBuffer(5, 400);
    expect(buffer.isAnimating()).toBe(false);
    
    buffer.push({ id: 1, createdAt: Date.now() });
    buffer.startAnimating();
    expect(buffer.isAnimating()).toBe(true);
    
    buffer.clear();
    buffer.tick(Date.now()); // tick detects empty, stops loop
    expect(buffer.isAnimating()).toBe(false);
  });
});
```

---

### 任务 4: Sprite Sheet (.tscn 解析)

#### 纯函数 — TSCN 解析器

```typescript
// sprite.test.ts
describe('parseTscnAtlasTextures', () => {
  const sampleTscn = `
[sub_resource type="AtlasTexture" id="blip_0"]
region = Rect2(0, 0, 32, 32)
[sub_resource type="AtlasTexture" id="blip_1"]
region = Rect2(32, 0, 32, 32)
`;

  it('extracts atlas regions from tscn', () => {
    const atlas = parseTscnAtlasTextures(sampleTscn);
    expect(atlas.get('blip_0')).toEqual({ x: 0, y: 0, w: 32, h: 32 });
    expect(atlas.get('blip_1')).toEqual({ x: 32, y: 0, w: 32, h: 32 });
  });

  it('handles empty tscn gracefully', () => {
    const atlas = parseTscnAtlasTextures('');
    expect(atlas.size).toBe(0);
  });

  it('handles decimal region values', () => {
    const tscn = '[sub_resource type="AtlasTexture" id="a"]\nregion = Rect2(1.5, 2.5, 30, 40)\n';
    const atlas = parseTscnAtlasTextures(tscn);
    expect(atlas.get('a')).toEqual({ x: 1.5, y: 2.5, w: 30, h: 40 });
  });
});

describe('parseSpriteFramesOrder', () => {
  const sampleTscn = `
[sub_resource type="SpriteFrames" id="3"]
animations = [{
"frames": [SubResource("blip_0"), SubResource("blip_1"), SubResource("blip_2")],
"speed": 24.0
}]
`;

  it('extracts frame order and fps', () => {
    const result = parseSpriteFramesOrder(sampleTscn);
    expect(result.frames).toEqual(['blip_0', 'blip_1', 'blip_2']);
    expect(result.fps).toBe(24);
  });

  it('defaults fps to 24 when missing', () => {
    const tscn = '[sub_resource type="SpriteFrames"]\n...';
    const result = parseSpriteFramesOrder(tscn);
    expect(result.fps).toBe(24);
  });
});
```

---

### 任务 5: 字号感知

#### 纯函数 — 从 CSS 字符串提取像素值

```typescript
// sanitize.test.ts 或独立文件
describe('parseFontSizePx', () => {
  it('extracts px value from CSS string', () => {
    expect(parseFontSizePx('16px')).toBe(16);
    expect(parseFontSizePx('14.5px')).toBe(14.5);
  });

  it('returns fallback for missing input', () => {
    expect(parseFontSizePx('')).toBe(14);
    expect(parseFontSizePx('invalid')).toBe(14);
  });

  it('clamps to minimum 8', () => {
    expect(parseFontSizePx('4px')).toBe(8);
  });
});
```

---

### 任务 6: reducedEffects 清理

#### 行为测试 — 设定传播

```typescript
// integration.test.ts
describe('settings propagation', () => {
  it('clears decorations when reducedEffects is toggled on', () => {
    const plugin = createTestPlugin({ reducedEffects: false });
    const clearSpy = vi.spyOn(plugin, 'clearAllDecorations');
    
    plugin.settings.reducedEffects = true;
    plugin.saveSettings();
    
    expect(clearSpy).toHaveBeenCalledOnce();
  });

  it('does NOT clear decorations when reducedEffects is toggled off', () => {
    const plugin = createTestPlugin({ reducedEffects: true });
    const clearSpy = vi.spyOn(plugin, 'clearAllDecorations');
    
    plugin.settings.reducedEffects = false;
    plugin.saveSettings();
    
    expect(clearSpy).not.toHaveBeenCalled();
  });

  it('propagates sound setting to audioService', () => {
    const plugin = createTestPlugin({ sound: true });
    plugin.settings.sound = false;
    plugin.saveSettings();
    expect(plugin.audioService.isEnabled).toBe(false);
  });

  it('propagates baseXp setting to xpService', () => {
    const plugin = createTestPlugin({ baseXp: 50 });
    const setXpSpy = vi.spyOn(plugin.xpService, 'setBaseXp');
    plugin.settings.baseXp = 100;
    plugin.saveSettings();
    expect(setXpSpy).toHaveBeenCalledWith(100);
  });
});
```

---

### XP 服务测试（已有独立 XPService，直接可测）

```typescript
// xp.test.ts
describe('XPService', () => {
  function createService(baseXp = 50) {
    const plugin = {
      settings: {} as any,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      updateStatusBar: vi.fn(),
      clearAllDecorations: vi.fn(),
    };
    return new XPService(plugin, baseXp);
  }

  it('starts at level 1 with 0 xp', () => {
    const svc = createService();
    expect(svc.level).toBe(1);
    expect(svc.xp).toBe(0);
    expect(svc.xpNextAbs).toBe(100); // 2 * baseXp
  });

  it('levels up when xp reaches nextAbs', () => {
    const svc = createService();
    svc.xp = 99;
    svc.xpNextAbs = 100;
    const leveled = svc.addXp(1);
    expect(leveled).toBe(true);
    expect(svc.level).toBe(2);
    expect(svc.xp).toBe(100);
  });

  it('does not level up when xp is below nextAbs', () => {
    const svc = createService();
    svc.xp = 98;
    svc.xpNextAbs = 100;
    const leveled = svc.addXp(1);
    expect(leveled).toBe(false);
    expect(svc.level).toBe(1);
  });

  it('computes correct nextAbs after level up (formula: xp + round(base*level/10)*10)', () => {
    const svc = createService(50);
    svc.xp = 99;
    svc.xpNextAbs = 100;
    svc.addXp(1);
    // xp=100, level=2, base=50 -> round(50*2/10)*10 = round(10)*10 = 100
    // xpNextAbs = 100 + 100 = 200
    expect(svc.xpNextAbs).toBe(200);
  });

  it('progress shows correct values', () => {
    const svc = createService(50);
    svc.xp = 30;
    svc.xpLevelStart = 0;
    svc.xpNextAbs = 100;
    expect(svc.progress).toEqual({ current: 30, max: 100 });
  });

  it('progress handles zero max gracefully', () => {
    const svc = createService(50);
    svc.xp = 0;
    svc.xpLevelStart = 0;
    svc.xpNextAbs = 0;
    expect(svc.progress.max).toBeGreaterThanOrEqual(1);
  });

  it('reset restores initial state', () => {
    const svc = createService(50);
    svc.xp = 500;
    svc.level = 5;
    svc.reset();
    expect(svc.xp).toBe(0);
    expect(svc.level).toBe(1);
    expect(svc.xpNextAbs).toBe(100);
    expect(svc.xpLevelStart).toBe(0);
  });

  it('persists after addXp', async () => {
    const plugin = {
      settings: {} as any,
      saveSettings: vi.fn().mockResolvedValue(undefined),
      updateStatusBar: vi.fn(),
      clearAllDecorations: vi.fn(),
    };
    const svc = new XPService(plugin, 50);
    svc.addXp(5);
    expect(plugin.saveSettings).toHaveBeenCalled();
    expect(plugin.settings.xp).toBe(5);
    expect(plugin.settings.level).toBe(1);
  });

  it('mutiple level-ups in one addXp call', () => {
    const svc = createService(10); // small base xp for fast leveling
    svc.xp = 0;
    svc.xpNextAbs = 20; // 2 * 10
    svc.addXp(50); // should trigger 2 level-ups
    expect(svc.level).toBeGreaterThanOrEqual(2);
  });
});
```

---

## 三、无法用断言验证的维度 → 用基准数据

对于确实无法自动化断言的"看起来好不好"，用**产出的数据做手动审查**替代：

### 3.1 黄金数据（Golden Data）

为关键输入序列手动记录预期输出，存为 fixture。测试时对比当前输出与黄金输出是否一致。

```typescript
// golden-pitch.json
{
  "fastTyping": {
    "inputs": [0, 50, 100, 150, 200],   // 时间 ms
    "expectedPitches": [1.05, 1.10, 1.15, 1.20, 1.25]  // 5 连击
  },
  "pauseThenType": {
    "inputs": [0, 200, 400],            // 打字、停顿 200ms (>180)、再打
    "expectedPitches": [1.05, 1.0, 1.05]
  }
}
```

### 3.2 性能基准

```typescript
describe('performance', () => {
  it('100 rapid keystrokes under 500ms', () => {
    const start = performance.now();
    for (let i = 0; i < 100; i++) plugin.simulateKeystroke('a');
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });

  it('trail buffer does not leak beyond MAX_TRAIL', () => {
    for (let i = 0; i < 1000; i++) buffer.push({ id: i, createdAt: Date.now() });
    buffer.cleanup(Date.now());
    expect(buffer.items.length).toBeLessThanOrEqual(5);
  });
});
```

---

## 四、执行顺序建议

```
步骤 0: 安装 vitest + 配置 tsconfig (test include)
  ↓
步骤 1: 抽出纯函数 (每个任务 5-10 行，不改行为)
  ↓
步骤 2: 先写 XP 测试 (已有独立 XPService，立即可测，获得反馈)
  ↓
步骤 3: 按任务顺序：重构 → 测试 → 实现 → 验证
  ├─ 任务1: 抽 computePitch() → 写 test → 接入 main.ts
  ├─ 任务2: 抽 computeShakeEnd() → 写 test → 接入 EffectManager
  ├─ 任务3: 抽 computeTrailTransform() + TrailBuffer → 写 test → 接入
  ├─ 任务4: 抽 parseTscn() → 写 test → 接入
  ├─ 任务5: 抽 parseFontSizePx() → 写 test → 接入
  ├─ 任务6: 写 plugin integration test → 改 saveSettings
  └─ 任务7: 写 mock 测试 → 改 event handler
```

每步一个 commit，测试通过才进下一步。

---

## 五、关键：哪些测试能真正阻止回归

| 测试类别 | 阻止什么回归 | 优先级 |
|----------|-------------|--------|
| XP 公式测试 | level-up 计算改坏 | **高** |
| Pitch 计算测试 | 音效节奏感退化 | **高** |
| Trail transform 测试 | 动画位置/缩放异常 | 高 |
| TSCN 解析测试 | Sprite 帧错位/缺失 | 高 |
| Timer 行为测试 | Pitch 不复位、Shake 不停 | 中 |
| Settings 传播测试 | 设定改了但服务没响应 | 中 |
| 性能基准 | 键盘输入延迟/卡顿 | 低（手动） |
| Shake end 计算 | Shake 持续时间异常 | 低 |

**最低可行集合**: XP 公式 + Pitch 计算 + Trail transform = 3 个纯函数测试文件即可覆盖大部分"体感差异"的根源。
