import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";

import { Range } from "@codemirror/state";
import { RATE_LIMITS } from "./constants";
import { Settings } from "./types";

// ── Font base64 (lazy-loaded by main.ts) ──

let fontBase64: string | null = null;
function getFontBase64(): string {
  if (fontBase64) return fontBase64;
  return "";
}
export function setFontBase64(b64: string) { fontBase64 = b64; }

// ── Widget: Floating char label (blip/boom text) ──

class FloatingLabelWidget extends WidgetType {
  private text: string;
  private color: string;
  private fontSize: number;
  private ttl: number;
  private createdAt: number;
  private imgEl: HTMLImageElement | null = null;
  private animTimer: number | null = null;

  constructor(text: string, color: string, fontSize: number, ttl: number) {
    super();
    this.text = text;
    this.color = color;
    this.fontSize = fontSize;
    this.ttl = ttl;
    this.createdAt = Date.now();
  }

  toDOM(_view: EditorView): HTMLElement {
    const esc = (s: string) => s.replace(/[&<>"']/g, c =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
    const wrap = document.createElement("span");
    wrap.className = "rc-widget-container";

    const fontData = getFontBase64();
    const fontFamily = fontData
      ? "'GravityBold8', 'Cascadia Code', 'Consolas', monospace"
      : "'Cascadia Code', 'Consolas', monospace";
    const fontFace = fontData
      ? `@font-face { font-family: 'GravityBold8'; src: url(data:font/ttf;base64,${fontData}) format('truetype'); font-weight: normal; font-style: normal; }`
      : "";

    const paddingX = 2;
    const paddingY = 1;
    const baseline = this.fontSize + paddingY;

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" height="${baseline + paddingY}">
  <defs>
    <style><![CDATA[
      ${fontFace}
      .t { font-family: ${fontFamily}; font-size: ${this.fontSize}px; fill: ${this.color}; }
    ]]></style>
  </defs>
  <text class="t" x="${paddingX}" y="${baseline}">${esc(this.text)}</text>
</svg>`;

    const img = document.createElement("img");
    img.className = "rc-label";
    img.src = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;

    this.imgEl = img;
    wrap.appendChild(img);

    this.startAnimation();

    return wrap;
  }

  private startAnimation(): void {
    const floatEm = 0.7;
    const scaleAdd = 0.6;

    const tick = () => {
      if (!this.imgEl) return;
      const now = Date.now();
      const age = now - this.createdAt;
      const progress = Math.max(0, Math.min(1, age / this.ttl));
      const y = -(1.1 + floatEm * progress);
      const s = 1.6 + scaleAdd * progress;
      this.imgEl.style.transform = `translateY(${y}em) scale(${s})`;

      if (progress < 1) {
        this.animTimer = window.setTimeout(tick, 50);
      }
    };

    this.animTimer = window.setTimeout(tick, 50);
  }

  destroy(_dom: HTMLElement): void {
    if (this.animTimer !== null) {
      window.clearTimeout(this.animTimer);
      this.animTimer = null;
    }
    this.imgEl = null;
  }
}

// ── Widget: Icon decoration (blip/boom/newline SVG icon) ──

class IconWidget extends WidgetType {
  private iconName: string;
  private domEl: HTMLElement | null = null;

  constructor(iconName: string) {
    super();
    this.iconName = iconName;
  }

  toDOM(view: EditorView): HTMLElement {
    const wrap = document.createElement("span");
    wrap.className = "rc-widget-container";

    const icon = document.createElement("span");
    icon.className = `rc-icon rc-icon-${this.iconName}`;
    icon.innerHTML = this.getSVG();
    wrap.appendChild(icon);

    this.domEl = wrap;
    return wrap;
  }

  setTransform(y: number, s: number): void {
    if (this.domEl) {
      this.domEl.style.transform = `translateY(${y}em) scale(${s})`;
    }
  }

  destroy(_dom: HTMLElement): void {
    this.domEl = null;
  }

  private getSVG(): string {
    // Simple inline SVGs — no external file dependency at runtime
    switch (this.iconName) {
      case "blip":
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="18" height="18"><circle cx="9" cy="9" r="6" fill="url(#blip-g)" opacity="0.9"/><defs><radialGradient id="blip-g"><stop offset="0%" stop-color="#ff0"/><stop offset="100%" stop-color="#f0f"/></radialGradient></defs></svg>`;
      case "boom":
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="24" height="24"><circle cx="16" cy="16" r="14" fill="#ff4400" opacity="0.8"/><circle cx="16" cy="16" r="14" fill="none" stroke="#ffaa00" stroke-width="3" opacity="0.6" transform="scale(0.8) translate(4,4)"/></svg>`;
      case "newline":
        return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18 18" width="14" height="14"><path d="M4 4v6h6" fill="none" stroke="#4fc3f7" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 10L4 4" fill="none" stroke="#4fc3f7" stroke-width="2.5" stroke-linecap="round"/></svg>`;
      default:
        return "";
    }
  }
}

// ── ViewPlugin ──

interface PendingEffect {
  type: "blip" | "boom" | "newline";
  pos: number;
  charLabel?: string;
}

class RidiculousViewPlugin {
  decorations: DecorationSet = Decoration.none;
  private view: EditorView;
  private settings: Settings;
  private pendingEffects: PendingEffect[] = [];
  private animFrameId: number | null = null;
  private lastBlipTime: number = 0;
  private lastBoomTime: number = 0;
  private shakeEndAt: number = 0;
  private shakeTimerId: number | null = null;
  private shakeDOM: HTMLElement | null = null;

  // Lifetime-tracked overlay system: each batch keeps its own decorations
  private activeItems: Array<{
    id: number;
    type: string;
    decorations: Range<Decoration>[];
    iconWidget: IconWidget | null;
    ttl: number;
    createdAt: number;
  }> = [];
  private nextId = 0;

  // ── Combo trail animation constants ──

  private static readonly TRAIL_BLIP_MS = 400;
  private static readonly TRAIL_BOOM_MS = 650;
  private static readonly TRAIL_NEWLINE_MS = 350;
  private static readonly TRAIL_FRAME_MS = 50;
  private static readonly TRAIL_FLOAT_EM = 0.7;
  private static readonly TRAIL_SCALE_ADD = 0.6;
  private static readonly MAX_TRAIL = 5;

  private animTimers: Map<string, number> = new Map();

  // Color generation matching the Godot original
  private static randomGodotColor(): string {
    const r = Math.min(255, Math.round(Math.random() * 510));
    const g = Math.min(255, Math.round(Math.random() * 510));
    const b = Math.min(255, Math.round(Math.random() * 510));
    return `rgb(${Math.min(255, r)}, ${Math.min(255, g)}, ${Math.min(255, b)})`;
  }

  constructor(view: EditorView, settings: Settings) {
    this.view = view;
    this.settings = settings;
  }

  update(update: ViewUpdate): void {
    if (!update.docChanged) return;

    for (const tr of update.transactions) {
      tr.changes.iterChanges(
        (fromA: number, toA: number, _fromB: number, toB: number, inserted: import("@codemirror/state").Text) => {
          const insertedText = inserted.toString();
          const removedLength = toA - fromA;

          if (insertedText.length > 0 && !this.settings.reducedEffects) {
            this.handleInsert(toB, insertedText);
          }

          if (removedLength > 0 && !this.settings.reducedEffects) {
            this.handleDelete(fromA);
          }
        }
      );
    }
  }

  private pendingCount(type: PendingEffect["type"]): number {
    return this.pendingEffects.filter((e) => e.type === type).length;
  }

  private handleInsert(pos: number, text: string): void {
    const now = Date.now();
    if (now - this.lastBlipTime < RATE_LIMITS.BLIP_MS) return;
    this.lastBlipTime = now;

    if (
      text.includes("\n") &&
      this.settings.blips &&
      this.pendingCount("newline") < RATE_LIMITS.MAX_DECORATIONS_PER_TYPE
    ) {
      this.pendingEffects.push({ type: "newline", pos });
    }

    if (
      this.settings.blips &&
      this.pendingCount("blip") < RATE_LIMITS.MAX_DECORATIONS_PER_TYPE
    ) {
      const charLabel = this.settings.chars ? this.sanitizeLabel(text[0]) : undefined;
      this.pendingEffects.push({ type: "blip", pos, charLabel });
    }

    this.scheduleAnimation();

    if (this.settings.shake) {
      this.triggerShake(text.includes("\n") ? 140 : 120);
    }
  }

  private handleDelete(pos: number): void {
    const now = Date.now();
    if (now - this.lastBoomTime < RATE_LIMITS.BOOM_MS) return;
    this.lastBoomTime = now;

    if (
      this.settings.explosions &&
      this.pendingCount("boom") < RATE_LIMITS.MAX_DECORATIONS_PER_TYPE
    ) {
      const charLabel = this.settings.chars ? "BACKSPACE" : undefined;
      this.pendingEffects.push({ type: "boom", pos, charLabel });
    }

    this.scheduleAnimation();

    if (this.settings.shake) {
      this.triggerShake(180);
    }
  }

  private scheduleAnimation(): void {
    if (this.animFrameId !== null) return;
    this.animFrameId = window.requestAnimationFrame(() => this.applyEffects());
  }

  private rebuildDecorations(): void {
    const all: Range<Decoration>[] = [];
    for (const item of this.activeItems) {
      all.push(...item.decorations);
    }
    this.decorations = Decoration.set(all);
    this.view.dispatch();
  }

  private applyEffects(): void {
    this.animFrameId = null;
    if (this.pendingEffects.length === 0) return;

    const typesTriggered = new Set<string>();

    for (const effect of this.pendingEffects) {
      const pos = Math.min(effect.pos, this.view.state.doc.length);
      if (pos >= this.view.state.doc.length) continue;

      typesTriggered.add(effect.type);
      const cursorPos = pos;
      const itemDecorations: Range<Decoration>[] = [];
      let iconWidget: IconWidget | null = null;
      let ttl: number;

      switch (effect.type) {
        case "blip": {
          ttl = RidiculousViewPlugin.TRAIL_BLIP_MS;
          const color = RidiculousViewPlugin.randomGodotColor();
          if (effect.charLabel && this.settings.chars) {
            const widget = new FloatingLabelWidget(effect.charLabel, color, 18, ttl);
            itemDecorations.push(
              Decoration.widget({ widget, side: 1 }).range(cursorPos, cursorPos)
            );
          }
          iconWidget = new IconWidget("blip");
          itemDecorations.push(
            Decoration.widget({ widget: iconWidget, side: 1 }).range(cursorPos, cursorPos)
          );
          break;
        }
        case "boom": {
          ttl = RidiculousViewPlugin.TRAIL_BOOM_MS;
          if (effect.charLabel && this.settings.chars) {
            const color = RidiculousViewPlugin.randomGodotColor();
            const widget = new FloatingLabelWidget(effect.charLabel, color, 18, ttl);
            itemDecorations.push(
              Decoration.widget({ widget, side: 1 }).range(cursorPos, cursorPos)
            );
          }
          iconWidget = new IconWidget("boom");
          itemDecorations.push(
            Decoration.widget({ widget: iconWidget, side: 1 }).range(cursorPos, cursorPos)
          );
          break;
        }
        case "newline": {
          ttl = RidiculousViewPlugin.TRAIL_NEWLINE_MS;
          iconWidget = new IconWidget("newline");
          itemDecorations.push(
            Decoration.widget({ widget: iconWidget, side: -1 }).range(pos, pos)
          );
          break;
        }
      }

      const id = this.nextId++;
      this.activeItems.push({
        id,
        type: effect.type,
        decorations: itemDecorations,
        iconWidget,
        ttl,
        createdAt: Date.now(),
      });
    }

    // Enforce MAX_TRAIL per type
    for (const type of typesTriggered) {
      const typeItems = this.activeItems.filter(item => item.type === type);
      if (typeItems.length > RidiculousViewPlugin.MAX_TRAIL) {
        const excess = typeItems.length - RidiculousViewPlugin.MAX_TRAIL;
        const toRemove = typeItems.slice(0, excess);
        this.activeItems = this.activeItems.filter(item => {
          if (item.type !== type) return true;
          return !toRemove.some(r => r.id === item.id);
        });
      }
    }

    this.rebuildDecorations();
    this.pendingEffects = [];

    // Start/continue per-type animation loops
    for (const type of typesTriggered) {
      this.ensureAnimating(type);
    }
  }

  // ── Per-type continuous frame animation loop ──

  private ensureAnimating(type: string): void {
    if (this.animTimers.has(type)) return;

    const tick = () => {
      const items = this.activeItems.filter(item => item.type === type);

      if (items.length === 0) {
        const timer = this.animTimers.get(type);
        if (timer) {
          window.clearTimeout(timer);
          this.animTimers.delete(type);
        }
        return;
      }

      const now = Date.now();
      const floatEm = RidiculousViewPlugin.TRAIL_FLOAT_EM;
      const scaleAdd = RidiculousViewPlugin.TRAIL_SCALE_ADD;
      const aliveIds = new Set<number>();

      for (const item of items) {
        const age = now - item.createdAt;
        const progress = Math.max(0, Math.min(1, age / item.ttl));

        if (progress >= 1) continue; // expired — remove below

        aliveIds.add(item.id);

        const y = -(1.1 + floatEm * progress);
        const s = 1.6 + scaleAdd * progress;

        // Update IconWidget transform (FloatingLabelWidget handles its own)
        if (item.iconWidget) {
          item.iconWidget.setTransform(y, s);
        }
      }

      // Remove expired items
      if (aliveIds.size !== items.length) {
        this.activeItems = this.activeItems.filter(item => {
          if (item.type !== type) return true;
          return aliveIds.has(item.id);
        });
        this.rebuildDecorations();
      }

      this.animTimers.set(type, window.setTimeout(tick, RidiculousViewPlugin.TRAIL_FRAME_MS));
    };

    this.animTimers.set(type, window.setTimeout(tick, RidiculousViewPlugin.TRAIL_FRAME_MS));
  }

  // ── Screen Shake ──

  triggerShake(extendMs: number): void {
    if (!this.settings.shake) return;

    const now = Date.now();
    const maxEnd = now + RATE_LIMITS.MAX_SHAKE_TOTAL_MS;
    this.shakeEndAt = Math.min(
      Math.max(this.shakeEndAt, now + Math.max(extendMs, this.settings.shakeDecayMs)),
      maxEnd
    );

    if (!this.shakeDOM) {
      this.shakeDOM = this.view.scrollDOM;
    }

    if (this.shakeTimerId === null) {
      this.startShakeLoop();
    }
  }

  private startShakeLoop(): void {
    const tick = () => {
      const now = Date.now();
      if (now >= this.shakeEndAt) {
        this.shakeTimerId = null;
        if (this.shakeDOM) {
          this.shakeDOM.setCssProps({ transform: "" });
        }
        return;
      }

      const amplitude = this.settings.shakeAmplitude;
      const angle = Math.random() * Math.PI * 2;
      const dx = Math.round(Math.cos(angle) * amplitude);
      const dy = Math.round(Math.sin(angle) * amplitude);

      if (this.shakeDOM) {
        this.shakeDOM.setCssProps({
          transform: `translate(${dx}px, ${dy}px)`,
          transition: "transform 0.03s linear",
        });
      }

      this.shakeTimerId = window.setTimeout(tick, RATE_LIMITS.SHAKE_FRAME_MS);
    };

    tick();
  }

  private sanitizeLabel(ch: string): string {
    if (ch === "\n") return "";
    if (ch === "\t") return "\u21B9";
    if (ch.trim() === "") return "SPACE";
    return ch;
  }

  clearDecorations(): void {
    for (const [, timer] of this.animTimers) {
      window.clearTimeout(timer);
    }
    this.animTimers.clear();
    this.activeItems = [];
    this.decorations = Decoration.none;
    this.pendingEffects = [];
    if (this.animFrameId !== null) {
      window.cancelAnimationFrame(this.animFrameId);
      this.animFrameId = null;
    }
    if (this.shakeTimerId !== null) {
      window.clearTimeout(this.shakeTimerId);
      this.shakeTimerId = null;
    }
    if (this.shakeDOM) {
      this.shakeDOM.setCssProps({ transform: "" });
    }
  }

  destroy(): void {
    this.clearDecorations();
  }
}

// ── Module-level instance reference for external cleanup ──

const activeInstances = new Set<RidiculousViewPlugin>();

export function clearActiveDecorations(): void {
  for (const inst of activeInstances) {
    inst.clearDecorations();
  }
}

// ── Factory function ──

export function createRidiculousPlugin(settings: Settings) {
  class RidiculousPluginAdapter extends RidiculousViewPlugin {
    constructor(view: EditorView) {
      super(view, settings);
      activeInstances.add(this);
    }
    destroy(): void {
      super.destroy();
      activeInstances.delete(this);
    }
  }
  return ViewPlugin.fromClass(RidiculousPluginAdapter, {
    decorations: (p: RidiculousPluginAdapter) => p.decorations,
  });
}
