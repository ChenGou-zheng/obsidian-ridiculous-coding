# Gap-Fix Task List: Obsidian vs VS Code `RediculousCoding`

每个任务独立、可验证、上下文边界明确。执行顺序按影响力从高到低排列。

---

## 任务 1: 动态 Pitch 递增（音效核心体验差异）

**影响**: 当前所有 blip 音效使用固定 `pitch: 1`，听起来完全单调。VS Code 版在连续快速打字时 pitch 递增，停顿后复位，这是游戏感的核心。

### VS Code 参考代码

**文件**: `RediculousCoding/src/extension.ts:149-189`

```typescript
// Pitch increase that resets shortly after typing stops
let pitchIncrease = 0;
let pitchResetTimer: NodeJS.Timeout | undefined;
const PITCH_RESET_MS = 180; // reset a short time after typing stops

// 在 onDidChangeTextDocument 的 insert 分支中：
pitchIncrease += 1.0;
if (pitchResetTimer) clearTimeout(pitchResetTimer);
pitchResetTimer = setTimeout(() => { pitchIncrease = 0; }, PITCH_RESET_MS);
const pitch = 1.0 + Math.min(20, pitchIncrease) * 0.05; // cap growth
playSound({ type: "blip", pitch }, settings.sound && !settings.reducedEffects);
```

### 当前 Obsidian 代码

**文件**: `src/main.ts:119` — 硬编码 `pitch: 1`

```typescript
this.audioService.play({ type: "blip", pitch: 1 });
```

### 修改范围

| 文件 | 操作 |
|------|------|
| `src/main.ts` | 在 `RidiculousCodingPlugin` 类中新增 `pitchIncrease` 和 `pitchResetTimer` 字段，在 `registerEditorEvents()` 的 editor-change 回调中使用动态 pitch |
| `src/types.ts` | 无需修改（`SoundEvent` 已支持 `pitch`） |
| `src/AudioService.ts` | 无需修改（`play()` 已使用 `event.pitch` 作为 `playbackRate`） |

### 实现边界

1. 在 `main.ts:109-129` 的 `registerEditorEvents()` 中，将 `pitch: 1` 替换为动态计算
2. 在 `RidiculousCodingPlugin` 类顶层（与 `statusBarItem` 并列）添加:
   - `private pitchIncrease = 0`
   - `private pitchResetTimer: number | null = null`
   - `private static readonly PITCH_RESET_MS = 180`
3. 在 editor-change 回调中（仅 insert 分支，保持 delete 分支不生成 blip 音效即可 — 当前实现 delete 也不会发 blip）:
   - `this.pitchIncrease += 1.0`
   - `clearTimeout` 旧 timer，重新 `setTimeout` 在 `PITCH_RESET_MS` 后将 `pitchIncrease` 归零
   - pitch 计算公式与 VS Code 完全一致: `1.0 + Math.min(20, pitchIncrease) * 0.05`
4. **不要修改** `AudioService.ts` — 它已经正确处理 `event.pitch`
5. **不要修改** EffectManager、XPService、Fireworks

### 验证标准

- 快速连续打字时 blip 音效 pitch 递增
- 停止打字 180ms 后再打，pitch 复位到 1.0
- 不超过 2.0（`Math.min(20, pitchIncrease)` 上限）

### 验证结果

✅ **已实现。验证方法：**
1. 在 Obsidian 中连续快速打字，blip 音效 pitch 应从 1.0 逐渐升高
2. 停止打字 180ms 后重新开始，pitch 应复位到 1.0
3. 上限为 1.0 + 20*0.05 = 2.0

**修改文件：** `src/main.ts` — 新增 `pitchIncrease`/`pitchResetTimer` 字段，替换硬编码 `pitch: 1` 为动态计算

---

## 任务 2: `shakeDecayMs` 设定项（缺失配置）

**影响**: VS Code 用户可调 shake 持续时间衰减。Obsidian 缺少该设定，shakeAmplitude slider 调整效果不够直观。

### VS Code 参考代码

**设置注册**: `RediculousCoding/package.json:57-63`

```json
"ridiculousCoding.shakeDecayMs": {
  "type": "number",
  "default": 120,
  "minimum": 20,
  "maximum": 2000,
  "description": "How long (ms) shake continues after the last keypress."
}
```

**使用处**: `RediculousCoding/src/extension.ts:16` — 从配置读取
```typescript
shakeDecayMs: cfg.get("shakeDecayMs", 120),
```

**EffectManager 使用**: `RediculousCoding/src/effects/EffectManager.ts:507`

```typescript
const decayMs = Math.max(20, cfg.get<number>('shakeDecayMs', 120));
const maxExtend = Math.max(extendMs, decayMs);
```

### 当前 Obsidian 代码

**`src/types.ts:6`**: `shakeAmplitude: number` — 无 `shakeDecayMs` 字段
**`src/constants.ts:8`**: `shakeAmplitude: 6` — 无 `shakeDecayMs` 默认值
**`src/EffectManager.ts:349-395`**: shake 循环无 decay 配置

### 修改范围

| 文件 | 操作 |
|------|------|
| `src/types.ts` | `Settings` 接口新增 `shakeDecayMs: number` |
| `src/constants.ts` | `DEFAULT_SETTINGS` 新增 `shakeDecayMs: 120` |
| `src/SettingsTab.ts` | 新增 slider 控件（20-2000, step 20） |
| `src/EffectManager.ts` | `triggerShake()` 使用 `settings.shakeDecayMs` 替代硬编码的 `extendMs` 值 |

### 实现边界

1. **`src/types.ts`**: 在 `Settings` 接口中添加 `shakeDecayMs: number`（按字母顺序插入 `shakeAmplitude` 之后）
2. **`src/constants.ts`**: 在 `DEFAULT_SETTINGS` 中添加 `shakeDecayMs: 120`
3. **`src/SettingsTab.ts`**: 添加 slider 设定项（label: "Shake decay (ms)"，范围 20-2000，step 20）。参考已有 `shakeAmplitude` slider 的实现模式，不要创建新的 UI 模式
4. **`src/EffectManager.ts:349`**: 将 `triggerShake(extendMs)` 改为不使用外部传入的 `extendMs`，内部使用 `this.settings.shakeDecayMs`。具体：`handleInsert` 调用改为 `triggerShake()`（无参），`handleDelete` 同理
5. **不要修改** `main.ts`、`XPService.ts`、`AudioService.ts`

### 验证标准

- Settings tab 中出现 "Shake decay (ms)" 滑块
- 默认值为 120
- 滑块可拖拽 20-2000
- shake 效果受该值控制

---

## 任务 3: Combo Trail 动画持续帧刷新（修复装饰过早消失）

**影响**: 当前每个 effect batch 在 `ttl` ms 后一次性移除。VS Code 版本在整个生命周期内逐帧更新 transform（float + scale），实现平滑的浮起+放大的 trail 动画。

### VS Code 参考代码

**`RediculousCoding/src/effects/EffectManager.ts:177-220`** — `ensureAnimating()`:

```typescript
private ensureAnimating(editor: vscode.TextEditor, kind: EffectKind) {
  const state = this.getEditorState(editor);
  if (state.animTimers[kind]) return;
  // ...
  const tick = () => {
    const st = this.getEditorState(editor);
    const buf = st.buffers[kind];
    if (!buf.length) {
      const t = st.animTimers[kind];
      if (t) clearTimeout(t);
      delete st.animTimers[kind];
      return;
    }
    const now = Date.now();
    const ttl = this.getTtl(kind);
    const { anim } = this.getComboConfig();
    const baseY = 1.1;
    const extraY = anim.floatEm;  // default 0.7
    const baseScale = 1.6;
    const extraScale = anim.scaleAdd;  // default 0.6

    // Update transforms per item based on age
    for (const item of buf) {
      const age = now - item.createdAt;
      const p = Math.max(0, Math.min(1, age / ttl));
      const y = -(baseY + extraY * p);
      const s = baseScale + extraScale * p;
      // ... 写入 after.textDecoration
    }
    // Re-apply all current options
    editor.setDecorations(dec, buf.map(b => b.opt));
    state.animTimers[kind] = setTimeout(tick, anim.frameMs);  // default 50
  };
  state.animTimers[kind] = setTimeout(tick, anim.frameMs);
}
```

**`RediculousCoding/src/effects/EffectManager.ts:160-170`** — `getComboConfig()`:

```typescript
private getComboConfig() {
  const cfg = vscode.workspace.getConfiguration('ridiculousCoding');
  const maxTrail = Math.max(0, cfg.get<number>('combo.maxTrail', 5));
  const blipMs = Math.max(0, cfg.get<number>('combo.ttl.blipMs', 400));
  const boomMs = Math.max(0, cfg.get<number>('combo.ttl.boomMs', 650));
  const newlineMs = Math.max(0, cfg.get<number>('combo.ttl.newlineMs', 350));
  const frameMs = Math.max(10, cfg.get<number>('combo.anim.frameMs', 50));
  const floatEm = Math.max(0, cfg.get<number>('combo.anim.floatEm', 0.7));
  const scaleAdd = Math.max(0, cfg.get<number>('combo.anim.scaleAdd', 0.6));
  return { maxTrail, ttl: { blipMs, boomMs, newlineMs }, anim: { frameMs, floatEm, scaleAdd } };
}
```

### 当前 Obsidian 代码

**`src/EffectManager.ts:341-344`** — 一次性 setTimeout 清除:

```typescript
window.setTimeout(() => {
  this.activeItems = this.activeItems.filter(item => item.id !== id);
  this.rebuildDecorations();
}, ttl);
```

**`src/EffectManager.ts:84-103`** — `FloatingLabelWidget.startAnimation()` 有自己的帧循环，但它的 TTL 和 anim 参数硬编码:
```typescript
const floatEm = 0.7;
const scaleAdd = 0.6;
const y = -(1.1 + floatEm * progress);
const s = 1.6 + scaleAdd * progress;
```

### 修改范围

| 文件 | 操作 |
|------|------|
| `src/EffectManager.ts` | 重写 `applyEffects()` 中的 activeItems 管理逻辑，添加持续帧动画循环 |
| `src/types.ts` | 可选：添加 `ComboConfig` 接口（当前阶段硬编码值即可，VS Code config 读取在 Obsidian 不需要） |
| `src/constants.ts` | 添加 combo 默认值常量 |

### 实现边界

1. **仅修改 `src/EffectManager.ts`** 的 `RidiculousViewPlugin` 类
2. 添加以下私有方法（不要创建新文件）:
   - `private ensureAnimating(type: string)`: 检查是否已有该类型的动画循环在运行。如果没有，启动 `tick()` 循环。`tick` 每次执行时刷新所有 activeItems 中对应该类型的 decoration 的 transform。当 activeItems 中不再有该类型的 item 时停止循环
   - 在 `applyEffects()` 中，每次添加新的 batch 后调用 `ensureAnimating()` 替代现在的一次性 `setTimeout`
3. Combo 参数（TTL、frameMs、floatEm、scaleAdd、maxTrail）作为 `RidiculousViewPlugin` 的私有常量或从 `RATE_LIMITS` 导入：
   - `TRAIL_BLIP_MS = 400`
   - `TRAIL_BOOM_MS = 650`
   - `TRAIL_NEWLINE_MS = 350`
   - `TRAIL_FRAME_MS = 50`
   - `TRAIL_FLOAT_EM = 0.7`
   - `TRAIL_SCALE_ADD = 0.6`
   - `MAX_TRAIL = 5`
4. 在 `clearDecorations()` 中清除所有 anim timer
5. **`FloatingLabelWidget` 的 `startAnimation()` 保持不变**（它处理的是单个 widget 的动画，本任务重新控制的是 decoration 级别的叠加层）
6. **不要修改** `main.ts`、`XPService.ts`、`AudioService.ts`、`Fireworks.ts`

### 验证标准

- 连续输入 5 个字符，能看到 5 个 label 在 400ms 存活期内各自独立浮起+放大
- 第 6 个字符出现时最早的那个被移除（MAX_TRAIL = 5）
- 所有 decorations 清除后 animation loop 自动停止
- Boom 使用 650ms TTL，newline 使用 350ms TTL

---

## 任务 4: Icon 改用 Sprite Sheet 帧动画（替代硬编码 SVG）

**影响**: 当前 `IconWidget` 使用硬编码的纯色 SVG 圆圈/路径。VS Code 版本解析 Godot `.tscn` 文件获得动画帧序列，从 sprite sheet PNG 中裁剪每帧并逐帧播放。

### VS Code 参考代码

**`RediculousCoding/src/effects/EffectManager.ts:287-335`** — `ensureSpriteData()`:

```typescript
private async ensureSpriteData(kind: EffectKind): Promise<void> {
  if (this.spriteData && this.spriteData[kind]) return;
  const dir = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'animations');
  const tscnUri = vscode.Uri.joinPath(dir, `${kind}.tscn`);
  const pngUri = vscode.Uri.joinPath(dir, `${kind}.png`);
  const tscnText = fs.readFileSync(tscnUri.fsPath, 'utf8');
  const pngB64 = Buffer.from(fs.readFileSync(pngUri.fsPath)).toString('base64');
  
  // Parse AtlasTextures regions by id
  const atlasMap = new Map<string, { x: number; y: number; w: number; h: number }>();
  const atlasBlocks = [...tscnText.matchAll(/\[sub_resource\s+type="AtlasTexture"\s+id="(.*?)"\][\s\S]*?region\s*=\s*Rect2\(([^\)]*)\)/g)];
  for (const m of atlasBlocks) {
    const id = m[1];
    const nums = m[2].split(',').map(s => parseFloat(s.trim()));
    if (nums.length >= 4) atlasMap.set(id, { x: nums[0], y: nums[1], w: nums[2], h: nums[3] });
  }
  // Parse SpriteFrames order and speed
  const framesOrder: string[] = [];
  const animBlock = tscnText.match(/\[sub_resource\s+type="SpriteFrames"[\s\S]*?animations\s*=\s*\[(\{[\s\S]*?\})\][\s\S]*?\n/);
  if (animBlock) {
    const block = animBlock[1];
    const subResRefs = [...block.matchAll(/SubResource\("(.*?)"\)/g)];
    for (const sr of subResRefs) framesOrder.push(sr[1]);
  }
  const speedMatch = tscnText.match(/"speed"\s*:\s*([0-9.]+)/);
  const fps = speedMatch ? Math.max(1, parseFloat(speedMatch[1])) : 24;

  const frames: Array<{ x: number; y: number; w: number; h: number }> = [];
  for (const id of framesOrder) {
    const rect = atlasMap.get(id);
    if (rect) frames.push(rect);
  }
  if (!frames.length && atlasMap.size) frames.push(...[...atlasMap.values()]);

  let sheetW = 0, sheetH = 0;
  for (const f of frames) { sheetW = Math.max(sheetW, f.x + f.w); sheetH = Math.max(sheetH, f.y + f.h); }

  // Prebuild frame SVG URIs
  const frameUris: vscode.Uri[] = frames.map(f => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg ...><image href="data:image/png;base64,${pngB64}" x="-${f.x}" y="-${f.y}" .../></svg>`;
    return vscode.Uri.parse('data:image/svg+xml;utf8,' + encodeURIComponent(svg));
  });
  this.spriteData = ...;
}
```

**`RediculousCoding/src/effects/EffectManager.ts:350-435`** — `playSpriteAnim()`:

复杂逻辑，blip/boom/newline 各自有不同的帧定位计算。

### 当前 Obsidian 代码

**`src/EffectManager.ts:116-148`** — `IconWidget.getSVG()` 硬编码静态 SVG:
```typescript
case "blip":
  return `<svg ...><circle cx="9" cy="9" r="6" fill="url(#blip-g)" .../>...`
case "boom":
  return `<svg ...><circle cx="16" cy="16" r="14" .../>...`
case "newline":
  return `<svg ...><path d="M4 4v6h6" .../>...`
```

### 前置依赖

**任务 4 必须在任务 3 之后执行**，因为帧动画需要持续 animation loop 来推进帧索引。任务 3 的 `ensureAnimating()` 循环可以作为帧推进的基础设施。

### 修改范围

| 文件 | 操作 |
|------|------|
| `src/EffectManager.ts` | 新增 `ensureSpriteData()` 和 `playSpriteAnim()` 方法；修改 `applyEffects()` 使用 sprite 替代 IconWidget |
| `src/constants.ts` | 添加动画资源路径常量 |
| `media/animations/` | 确保 `.tscn` 和 `.png` 文件存在（从 VS Code 仓库复制）|

### 实现边界

1. 从 `RediculousCoding/media/animations/` 复制 `blip.tscn`、`blip.png`、`boom.tscn`、`boom.png`、`newline.tscn`、`newline.png` 到 Obsidian 项目的 `media/animations/`
2. 在 `src/EffectManager.ts` 的 `RidiculousViewPlugin` 类中新增:
   - `private spriteData: Map<string, SpriteData>` — 缓存已解析的 sprite
   - `private async ensureSpriteData(kind: string): Promise<SpriteData>` — 读取 `.tscn` 和 `.png`，用与 VS Code **完全相同的正则表达式** 解析（复制粘贴 `matchAll` 正则逻辑，不要自己重写解析）
   - `private playSpriteAnim(kind: string, pos: number): void` — 在当前 cursor 位置逐帧播放。使用 `Decoration.widget()` 创建临时 widget，每帧替换为新的 sprite 帧
3. 在 `applyEffects()` 中，blip/boom/newline 分支调用 `playSpriteAnim()` 替代当前的 `IconWidget`
4. **素材加载使用 Obsidian API**: 用 `this.plugin.app.vault.adapter.getResourcePath()` + `requestUrl` 获取文件（与 font 加载方式一致）
5. **不要修改** `FloatingLabelWidget`（char label 保持 SVG 文字方式）
6. **不要修改** `main.ts`、`XPService.ts`、`AudioService.ts`、`Fireworks.ts`

### 风险提示

- `.tscn` 文件是否存在于 VS Code 仓库的 `media/animations/` 中。如果不存在，需要从 https://github.com/merenut/RediculousCoding 下载
- 帧动画 widget 的 toDOM 需要频繁创建/销毁，可能有性能问题。先从 blip 单类型开始，验证通过后再扩展

### 验证标准

- blip 出现时显示多帧动画（而不是静态圆圈）
- 每帧正确裁剪 sprite sheet 的区域
- 帧率与 .tscn 中的 speed 字段一致
- 动画播完后自动清理 widget

---

## 任务 5: 编辑器字号感知的 Caret 尺寸计算

**影响**: blip/boom 的 label 和 icon 大小目前硬编码为 18px。在不同字号下效果不一致。VS Code 版读取 editor 配置动态计算。

### VS Code 参考代码

**`RediculousCoding/src/effects/EffectManager.ts:148-158`** — `getCaretHeightEm()`:

```typescript
private getCaretHeightEm(editor: vscode.TextEditor): number {
  try {
    const cfg = vscode.workspace.getConfiguration('editor', editor.document.uri);
    const fontSize = Math.max(8, cfg.get<number>('fontSize', 14));
    const lineHeightPx = Math.max(0, cfg.get<number>('lineHeight', 0));
    if (lineHeightPx > 0) return lineHeightPx / fontSize;
    return 1.35;
  } catch {
    return 1.35;
  }
}
```

**`RediculousCoding/src/effects/EffectManager.ts:234-241`** — `getEditorFontSizePx()`:

```typescript
private getEditorFontSizePx(editor: vscode.TextEditor): number {
  try {
    const cfg = vscode.workspace.getConfiguration('editor', editor.document.uri);
    return Math.max(8, cfg.get<number>('fontSize', 14));
  } catch {
    return 14;
  }
}
```

### 当前 Obsidian 代码

**`src/EffectManager.ts:95, 297-299`** — `FloatingLabelWidget` 和 `applyEffects` 中 `fontSize` 硬编码为 `18`:

```typescript
this.fontSize = fontSize;  // 构造函数传入 18
const widget = new FloatingLabelWidget(effect.charLabel, color, 18, 400);
```

### 修改范围

| 文件 | 操作 |
|------|------|
| `src/EffectManager.ts` | 在 `RidiculousViewPlugin` 类中新增 `getEditorFontSizePx(): number` 方法；修改 `applyEffects()` 中传入 `FloatingLabelWidget` 的 `fontSize` 参数为动态计算值 |

### 实现边界

1. 在 `RidiculousViewPlugin` 类中新增:
   ```typescript
   private getEditorFontSizePx(): number {
     try {
       const cssFontSize = this.view.dom.style.fontSize || 
         getComputedStyle(this.view.dom).fontSize;
       const px = parseFloat(cssFontSize);
       return Math.max(8, isNaN(px) ? 14 : px);
     } catch {
       return 14;
     }
   }
   ```
   （Obsidian/CodeMirror 6 没有 `vscode.workspace.getConfiguration`，替代为从 DOM 样式读取）
2. 在 `applyEffects()` 中，将硬编码 `18` 替换为 `this.getEditorFontSizePx()`
3. **不要修改** `main.ts`、`AudioService.ts`、`XPService.ts`

### 验证标准

- 在 Obsidian 设置中切换不同字号后 blip label 大小自适应
- 默认字号（16px）下效果与当前硬编码 18px 视觉接近

---

## 任务 6: reducedEffects 切换时清除已有装饰

**影响**: 用户在打字过程中切换到 reduced effects 模式，当前已有的 decorations 不会消失，只有在新的 keystroke 时才不再生成新 decorations。

### VS Code 参考代码

**`RediculousCoding/src/extension.ts:123-128`**:

```typescript
// If reduced effects was just enabled, clear all decorations
if (!oldReducedEffects && settings.reducedEffects) {
  vscode.window.visibleTextEditors.forEach(editor => {
    effects.clearAllDecorations(editor);
  });
}
```

**`RediculousCoding/src/effects/EffectManager.ts:630-651`** — `clearAllDecorations()`: 清除所有 decoration type、重置 buffer、停止动画 timers。

### 当前 Obsidian 代码

**`src/main.ts:162-168`** — `saveSettings()` 在 settings 变更时调用，但没有检测 `reducedEffects` 切换:

```typescript
async saveSettings() {
  await this.saveData(this.settings);
  this.xpService.setBaseXp(this.settings.baseXp);
  this.audioService.isEnabled = this.settings.sound;
  this.updateStatusBar();
  this.getPanel()?.refresh();
}
```

### 修改范围

| 文件 | 操作 |
|------|------|
| `src/main.ts` | `saveSettings()` 中新增 `reducedEffects` 切换检测 + 清除 decorations 调用 |

### 实现边界

1. 在 `RidiculousCodingPlugin` 类中新增字段 `private oldReducedEffects: boolean`
2. 在 `onload()` 末尾 `this.oldReducedEffects = this.settings.reducedEffects`
3. 在 `saveSettings()` 中（在 `await this.saveData(...)` 之后）添加:
   ```typescript
   if (!this.oldReducedEffects && this.settings.reducedEffects) {
     this.clearAllDecorations();
   }
   this.oldReducedEffects = this.settings.reducedEffects;
   ```
4. **不要修改** `EffectManager.ts` — `clearActiveDecorations()` 已存在于 `src/EffectManager.ts:430-434` 且可从 `main.ts:153-155` 调用
5. **不要修改** `AudioService.ts`、`XPService.ts`

### 验证标准

- 打字产生 blip/boom decorations
- 在 Settings/Control Panel 中勾选 "Reduced effects"
- 现有 decorations 立即消失

---

## 任务 7: 删除时 Boom 音效 + 新行 Blip 音效

**影响**: 当前 `main.ts` 的 `editor-change` 处理中，只有 insert 时播放 blip 音效。VS Code 版本在删除时播放 boom，新行也触发 blip 视觉效果+音效。

### VS Code 参考代码

**`RediculousCoding/src/extension.ts:196-212`**:

```typescript
} else if (isDelete && settings.explosions && !settings.reducedEffects) {
  effects.showBoom(editor, settings.chars, settings.shake, charLabel);
  playSound({ type: "boom" }, settings.sound && !settings.reducedEffects);
  pushState();
}

// Newline detection within this change
if (settings.blips && insertedText.includes("\n") && !settings.reducedEffects) {
  effects.showNewline(editor, settings.shake);
}
```

### 当前 Obsidian 代码

**`src/main.ts:110-129`** — `editor-change` 回调不区分 insert/delete:

```typescript
this.app.workspace.on("editor-change", (_editor: Editor, _info: unknown) => {
  const leveledUp = this.xpService.addXp(1);
  // ...
  if (!this.settings.reducedEffects && this.settings.sound) {
    this.audioService.play({ type: "blip", pitch: 1 });  // 始终 blip
  }
  // ...
})
```

### 修改范围

| 文件 | 操作 |
|------|------|
| `src/main.ts` | `registerEditorEvents()` 回调中区分 insert/delete，在 delete 时播放 boom；保持其他逻辑不变 |

### 实现边界

1. 在 `registerEditorEvents()` 的回调中使用 `_info` 参数获取 editor-change 的细节（Obsidian 的 `editor-change` 事件提供 `EditorChangeInfo`）。查看 Obsidian API 类型获取变更细节
2. 如果能获取到 `insertedText` 和 `removedChars`:
   - delete 分支播放 `{ type: "boom" }`
   - insert 分支保持 blip（配合任务 1 的动态 pitch）
3. **如果不能从 `_info` 获取**: 不强行实现。跳过此任务，改为在 `EffectManager.ts:196-212` 中利用 `ViewPlugin.update()` 中的 `tr.changes.iterChanges()` 来回调 `main.ts` 播放音效
4. **不要修改** `EffectManager.ts` 的装饰逻辑（已在 ViewPlugin 中处理 insert/delete 区分）
5. **不要修改** `AudioService.ts` — 已支持 `"boom"` 类型

### 验证标准

- 按 Delete/Backspace 时播放 boom 音效（不是 blip）
- 正常打字仍播放 blip 音效

---

## 优先级摘要

| 顺序 | 任务 | 类型 | 估距 |
|------|------|------|------|
| 1 | 动态 Pitch | 音效 | 小 |
| 2 | shakeDecayMs 设定 | 配置 | 小 |
| 3 | Combo Trail 帧刷新 | 视觉核心 | 中 |
| 4 | Sprite Sheet 动画 | 视觉核心 | 大 |
| 5 | 字号感知 | 视觉 | 小 |
| 6 | reducedEffects 清理 | 可用性 | 微小 |
| 7 | 删除音效 | 音效 | 小 |

建议按序号顺序执行，每完成一个验证后再继续下一个。
