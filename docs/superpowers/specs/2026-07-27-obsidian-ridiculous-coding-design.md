# Obsidian Ridiculous Coding 插件 — 设计文档

> 将 Ridiculous Coding 的疯狂编码体验移植到 Obsidian。

## 1. 概述

本插件在 Obsidian 编辑器中重现 Ridiculous Coding 的效果：每次按键都有视觉反馈（blip）、删除有爆炸效果（boom）、屏幕会震动、换行有动画、升级放烟花，配合音效和 XP 经验系统，让编码过程充满游戏感。

### 参考实现

- **原始 Godot 插件** — [jotson/ridiculous_coding](https://github.com/jotson/ridiculous_coding)
- **VS Code 移植** — [merenut/RediculousCoding](https://github.com/merenut/RediculousCoding)

## 2. 架构

插件采用模块化架构，每个模块职责单一，通过 `main.ts` 协调。

```
┌─────────────────────────────────────────────────┐
│                    main.ts                      │
│  插件入口: activate/deactivate, 配置分发         │
├──────────┬──────────┬───────────┬───────────────┤
│EffectMgr │XPService │AudioSvc   │ControlPanel   │
│(CM6装饰) │(经验等级)│(WebAudio) │(侧边栏面板)   │
├──────────┴──────────┴───────────┴───────────────┤
│           SettingsTab (设置面板)                 │
│           StatusBarItem (状态栏)                │
└─────────────────────────────────────────────────┘
```

## 3. 模块详述

### 3.1 `main.ts` — 插件入口

**职责：**
- 调用 `activate()` 初始化所有子模块
- 注册 CodeMirror 6 `ViewPlugin` 以监听编辑器事件
- 注册 Obsidian 命令（显示面板、重置 XP、切换效果）
- 注册设置变更监听 `onDidChangeConfiguration`
- 调用 `deactivate()` 清理资源

**事件处理流程：**
```
用户输入/删除
    │
    ▼
CodeMirror dispatchTransaction
    │
    ▼
ViewPlugin.update() 检测 contentChanges
    ├─ 输入字符 → EffectManager.showBlip() + AudioService.play('blip') + XPService.addXp(1)
    ├─ 删除字符 → EffectManager.showBoom() + AudioService.play('boom')
    └─ 换行符   → EffectManager.showNewline()
                        │
                        ▼
                   升级? → AudioService.play('fireworks') + ControlPanel.showFireworks()
```

### 3.2 `EffectManager.ts` — 视觉效果

使用 **CodeMirror 6 ViewPlugin** 管理所有视觉效果装饰。

| 效果 | 实现方式 | 触发条件 | 限制 |
|------|---------|---------|------|
| **Blip** | 光标位置插入 Widget（浮动 SVG/文本标签），向上飘移 + fade out | 每次字符输入 | 20ms 速率限制，最大 5 个并发 |
| **Boom** | 删除位置插入 Widget（爆炸 SVG 精灵动画） | 每次删除 | 100ms 速率限制 |
| **屏幕震动** | CSS `transform: translate(randX, randY)` 抖动 `.cm-scroller` | 输入/删除/换行 | 总时长 ≤ 400ms |
| **换行动画** | 新行位置插入 Widget（闪烁指示器 + 浮动） | 检测到 `\n` | 350ms TTL |
| **升级烟花** | 独立 DOM 层的 Canvas 粒子效果 | XPService 触发升级 | — |

**关键实现细节：**
- 使用 `ViewPlugin.fromClass()` 注册到 Obsidian 的 CodeMirror 编辑器
- 每个效果使用独立的 `DecorationType`
- 装饰使用 `WidgetType` 子类渲染 SVG/HTML 内容
- 每帧通过 `requestAnimationFrame` 更新位置/透明度/缩放
- 速率限制防止高频操作压垮渲染

**组件关系：**
```
EffectManager
├── showBlip(cursorPos, charLabel) → Decoration Widget + sprite anim
├── showBoom(cursorPos, charLabel) → Decoration Widget + sprite anim
├── showNewline(cursorPos) → Decoration Widget
├── shake(editor, duration) → CSS transform 循环
├── showFireworks() → Canvas 粒子系统
└── clearAllDecorations(editor) → 清理所有装饰
```

### 3.3 `XPService.ts` — 经验与等级系统

**经验规则：**
- 每个输入字符 +1 XP
- 升级公式：`nextXP = currentXP + round(BASE_XP * level / 10) * 10`
- 默认 `BASE_XP = 50`（可配置）

**接口：**
```
addXp(n: number): boolean   // 返回是否升级
reset(): void
getProgress(): { current, max }
```

**持久化：** 使用 `plugin.loadData()` / `plugin.saveData()` 保存 `{ xp, level, xpNextAbs, xpLevelStart }`。

### 3.4 `AudioService.ts` — 音效系统

**技术选型：** Web Audio API（`AudioContext`）

**功能：**
- 预加载嵌入的 WAV 资源（blip.wav, boom.wav, fireworks.wav）到 `AudioBuffer`
- **Blip** 播放时根据打字速度动态调整 playbackRate（pitch），模拟速度感
- 支持全局静音开关

**接口：**
```
configure(): Promise<void>   // 初始化 AudioContext，解码音频
play(event: SoundEvent): void
```

### 3.5 `SettingsTab.ts` — 设置面板

使用 Obsidian `PluginSettingTab` 实现。

| 设置键 | 类型 | 默认值 | 说明 |
|--------|------|--------|------|
| blips | toggle | true | 输入时显示 Blip 动画 |
| explosions | toggle | true | 删除时显示 Boom 动画 |
| chars | toggle | true | Blip/Boom 上叠加字符标签 |
| shake | toggle | true | 屏幕震动效果 |
| shakeAmplitude | slider (0-32) | 6 | 震动幅度(px) |
| sound | toggle | true | 音效开关 |
| fireworks | toggle | true | 升级烟花效果 |
| baseXp | slider (10-200) | 50 | XP 等级基数 |
| enableStatusBar | toggle | true | 状态栏显示等级/XP |
| reducedEffects | toggle | false | 无障碍模式（关闭所有视觉和音效） |

### 3.6 `ControlPanel.ts` — 侧边栏控制面板

使用 Obsidian `ItemView` 实现，注册为侧边栏视图。

**内容：**
- 🚀 当前 Level 显示
- XP 进度条（`current/max`）
- 快速开关按钮（Blip、Boom、Shake、Sound、Reduced Effects）
- 重置 XP 按钮
- 升级烟花展示区域

### 3.7 `types.ts` — 类型定义

```typescript
interface Settings {
  blips: boolean;
  explosions: boolean;
  chars: boolean;
  shake: boolean;
  shakeAmplitude: number;
  sound: boolean;
  fireworks: boolean;
  baseXp: number;
  enableStatusBar: boolean;
  reducedEffects: boolean;
}

interface XPData {
  xp: number;
  level: number;
  xpNextAbs: number;
  xpLevelStart: number;
}

type SoundEvent =
  | { type: 'blip'; pitch: number }
  | { type: 'boom' }
  | { type: 'fireworks' };
```

## 4. 依赖与构建

### 技术栈
- **语言：** TypeScript
- **构建：** esbuild（Obsidian 官方推荐，由 `obsidian-plugin` 模板提供）
- **运行时依赖：** 无（纯 Web API 实现）
- **最低 Obsidian 版本：** v0.15.0+（CodeMirror 6）

### 构建流程
```bash
npm install
npm run build    # esbuild 打包到 main.js
```

打包产物：`main.js`、`manifest.json`、`styles.css`、`media/` 目录（含 SVG/字体/音效）。

## 5. 音效与媒体资源

直接复用 VS Code 移植版中的媒体文件：
- `media/blip.svg` / `media/boom.svg` / `media/newline.svg` — 静态图标
- `media/blip.wav` / `media/boom.wav` / `media/fireworks.wav` — 音效
- `media/font/GravityBold8.ttf` — 字符标签字体

资源嵌入方式：音效在构建时复制到插件目录，运行时通过 `plugin.app.vault.adapter` 读取或通过 URL 加载。SVG 以 data URI 形式直接嵌入 Widget。

## 6. 无障碍

- `reducedEffects: true` 时关闭所有动画、装饰和音效
- XP 经验系统在 reducedEffects 模式下仍然正常工作
- 所有动画尊重 `prefers-reduced-motion` 媒体查询

## 7. 性能考虑

- 每个效果类型有速率限制（blip ≥ 20ms, boom ≥ 100ms）
- 最大并发装饰数限制（每类型 5 个）
- 屏幕震动总时长上限 400ms，防止高频 IPC
- 只在 viewport 可见范围内创建装饰（CodeMirror 的 `visibleRanges`）
- 编辑器关闭或切换时自动清理所有装饰

## 8. 目录结构

```
obsidian-ridiculous-coding/
├── src/
│   ├── main.ts
│   ├── EffectManager.ts
│   ├── XPService.ts
│   ├── AudioService.ts
│   ├── SettingsTab.ts
│   ├── ControlPanel.ts
│   ├── types.ts
│   └── constants.ts
├── media/
│   ├── blip.svg
│   ├── boom.svg
│   ├── newline.svg
│   ├── font/GravityBold8.ttf
│   └── sound/
│       ├── blip.wav
│       ├── boom.wav
│       └── fireworks.wav
├── manifest.json
├── package.json
├── tsconfig.json
├── version-bump.mjs
├── styles.css
└── README.md
```
