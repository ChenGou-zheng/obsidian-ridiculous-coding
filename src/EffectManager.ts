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

// ── Widget: Floating char label (blip/boom text) ──

class FloatingLabelWidget extends WidgetType {
  private text: string;
  private color: string;
  private fontSize: number;

  constructor(text: string, color: string, fontSize: number = 18) {
    super();
    this.text = text;
    this.color = color;
    this.fontSize = fontSize;
  }

  toDOM(view: EditorView): HTMLElement {
    const span = document.createElement("span");
    span.className = "rc-floating-label";
    span.textContent = this.text;
    span.setCssProps({
      color: this.color,
      fontSize: `${this.fontSize}px`,
    });

    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (prefersReducedMotion) {
      span.addClass("rc-floating-label-reduced");
      window.setTimeout(() => span.remove(), 300);
    } else {
      // Trigger float animation on next frame
      window.requestAnimationFrame(() => {
        span.setCssProps({
          transform: "translateY(-2.5em) scale(1.0)",
          opacity: "0",
        });
      });
      // Remove from DOM after animation
      window.setTimeout(() => span.remove(), 450);
    }

    return span;
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
    const span = document.createElement("span");
    span.className = `rc-icon rc-icon-${this.iconName}`;
    return span;
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

  private applyEffects(): void {
    this.animFrameId = null;
    if (this.pendingEffects.length === 0) return;

    const decorations: Range<Decoration>[] = [];

    for (const effect of this.pendingEffects) {
      const pos = Math.min(effect.pos, this.view.state.doc.length);
      if (pos >= this.view.state.doc.length) continue;

      const cursorPos = pos;

      switch (effect.type) {
        case "blip": {
          const color = RidiculousViewPlugin.randomGodotColor();
          if (effect.charLabel && this.settings.chars) {
            const widget = new FloatingLabelWidget(effect.charLabel, color);
            decorations.push(
              Decoration.widget({ widget, side: 1 }).range(cursorPos, cursorPos)
            );
          }
          const iconWidget = new IconWidget("blip");
          decorations.push(
            Decoration.widget({ widget: iconWidget, side: 1 }).range(cursorPos, cursorPos)
          );
          break;
        }
        case "boom": {
          if (effect.charLabel && this.settings.chars) {
            const color = RidiculousViewPlugin.randomGodotColor();
            const widget = new FloatingLabelWidget(effect.charLabel, color);
            decorations.push(
              Decoration.widget({ widget, side: 1 }).range(cursorPos, cursorPos)
            );
          }
          const iconWidget = new IconWidget("boom");
          decorations.push(
            Decoration.widget({ widget: iconWidget, side: 1 }).range(cursorPos, cursorPos)
          );
          break;
        }
        case "newline": {
          const iconWidget = new IconWidget("newline");
          decorations.push(
            Decoration.widget({ widget: iconWidget, side: -1 }).range(pos, pos)
          );
          break;
        }
      }
    }

    this.decorations = Decoration.set(decorations);
    this.pendingEffects = [];

    // Clear decorations after a short delay
    window.setTimeout(() => {
      this.decorations = Decoration.none;
      this.view.dispatch();
    }, 400);
  }

  // ── Screen Shake ──

  triggerShake(extendMs: number): void {
    if (!this.settings.shake) return;

    const now = Date.now();
    const maxEnd = now + RATE_LIMITS.MAX_SHAKE_TOTAL_MS;
    this.shakeEndAt = Math.min(
      Math.max(this.shakeEndAt, now + extendMs),
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
