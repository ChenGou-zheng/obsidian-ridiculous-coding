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
    return wrap;
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
    ttl: number;
    createdAt: number;
  }> = [];
  private nextId = 0;

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

    const newDecorations: Range<Decoration>[] = [];
    const types = new Set<string>();

    for (const effect of this.pendingEffects) {
      const pos = Math.min(effect.pos, this.view.state.doc.length);
      if (pos >= this.view.state.doc.length) continue;
      types.add(effect.type);

      const cursorPos = pos;

      switch (effect.type) {
        case "blip": {
          const color = RidiculousViewPlugin.randomGodotColor();
          if (effect.charLabel && this.settings.chars) {
            const widget = new FloatingLabelWidget(effect.charLabel, color, 18, 400);
            newDecorations.push(
              Decoration.widget({ widget, side: 1 }).range(cursorPos, cursorPos)
            );
          }
          const iconWidget = new IconWidget("blip");
          newDecorations.push(
            Decoration.widget({ widget: iconWidget, side: 1 }).range(cursorPos, cursorPos)
          );
          break;
        }
        case "boom": {
          if (effect.charLabel && this.settings.chars) {
            const color = RidiculousViewPlugin.randomGodotColor();
            const widget = new FloatingLabelWidget(effect.charLabel, color, 18, 650);
            newDecorations.push(
              Decoration.widget({ widget, side: 1 }).range(cursorPos, cursorPos)
            );
          }
          const iconWidget = new IconWidget("boom");
          newDecorations.push(
            Decoration.widget({ widget: iconWidget, side: 1 }).range(cursorPos, cursorPos)
          );
          break;
        }
        case "newline": {
          const iconWidget = new IconWidget("newline");
          newDecorations.push(
            Decoration.widget({ widget: iconWidget, side: -1 }).range(pos, pos)
          );
          break;
        }
      }
    }

    const id = this.nextId++;
    const ttl = types.has("boom") ? 650 : types.has("blip") ? 400 : 350;

    this.activeItems.push({ id, type: [...types][0], decorations: newDecorations, ttl, createdAt: Date.now() });
    this.rebuildDecorations();

    this.pendingEffects = [];

    window.setTimeout(() => {
      this.activeItems = this.activeItems.filter(item => item.id !== id);
      this.rebuildDecorations();
    }, ttl);
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
