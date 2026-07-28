import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
} from "@codemirror/view";

import { App, requestUrl } from "obsidian";
import { PLUGIN_ID, RATE_LIMITS } from "./constants";
import { Settings } from "./types";

// ── Module-level: last edit type for audio selection ──

let lastEditWasDelete = false;
export function wasLastEditDelete(): boolean { return lastEditWasDelete; }

// ── Font base64 (lazy-loaded by main.ts) ──

let fontBase64: string | null = null;
export function setFontBase64(b64: string) { fontBase64 = b64; }

// ── Sprite sheet data types & cache ──

interface SpriteFrame { x: number; y: number; w: number; h: number; }
interface SpriteData {
  frames: SpriteFrame[];
  sheetW: number;
  sheetH: number;
  fps: number;
  frameMs: number;
  pngBase64: string;
  frameUris: string[];
}

const spriteDataCache = new Map<string, SpriteData>();

export async function loadSpriteData(app: App, kind: string): Promise<void> {
  if (spriteDataCache.has(kind)) return;

  const tscnPath = app.vault.adapter.getResourcePath(
    `.obsidian/plugins/${PLUGIN_ID}/media/animations/${kind}.tscn`
  );
  const pngPath = app.vault.adapter.getResourcePath(
    `.obsidian/plugins/${PLUGIN_ID}/media/animations/${kind}.png`
  );

  const [tscnResp, pngResp] = await Promise.all([
    requestUrl({ url: tscnPath }),
    requestUrl({ url: pngPath }),
  ]);

  const tscnText = tscnResp.text;
  const pngBytes = new Uint8Array(pngResp.arrayBuffer);
  let binary = '';
  for (let i = 0; i < pngBytes.length; i++) {
    binary += String.fromCharCode(pngBytes[i]);
  }
  const pngB64 = btoa(binary);

  // Parse AtlasTextures regions by id — exact same regex as VS Code reference
  const atlasMap = new Map<string, SpriteFrame>();
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

  const frames: SpriteFrame[] = [];
  for (const id of framesOrder) {
    const rect = atlasMap.get(id);
    if (rect) frames.push(rect);
  }
  // Fallback: if order parsing failed, use atlas values in insertion order
  if (!frames.length && atlasMap.size) frames.push(...[...atlasMap.values()]);

  // Compute sheet dimensions from max extents
  let sheetW = 0, sheetH = 0;
  for (const f of frames) { sheetW = Math.max(sheetW, f.x + f.w); sheetH = Math.max(sheetH, f.y + f.h); }

  // Prebuild frame SVG URIs — matches VS Code clip-to-region pattern
  const frameMs = Math.max(10, Math.round(1000 / fps));
  const frameUris: string[] = frames.map(f => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f.w} ${f.h}" width="${f.w}" height="${f.h}">\n  <image href="data:image/png;base64,${pngB64}" x="-${f.x}" y="-${f.y}" width="${sheetW}" height="${sheetH}" preserveAspectRatio="none"/>\n</svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  });

  spriteDataCache.set(kind, { frames, sheetW, sheetH, fps, frameMs, pngBase64: pngB64, frameUris });
}

export function getSpriteData(kind: string): SpriteData | undefined {
  return spriteDataCache.get(kind);
}

// ── Module-level overlay DOM tracking for forced cleanup ──

let allOverlays: HTMLElement[] = [];

function track(el: HTMLElement): void {
  allOverlays.push(el);
}

function untrack(el: HTMLElement): void {
  allOverlays = allOverlays.filter(x => x !== el);
}

// ── Module-level instance registry for shake cleanup ──

const activeInstances = new Set<RidiculousViewPluginClass>();

export function clearAllEffects(): void {
  // Remove all overlay DOM elements
  for (const el of allOverlays) el.remove();
  allOverlays = [];
  // Stop shake on all active instances
  for (const inst of activeInstances) {
    inst.stopShake();
  }
}

// ── ViewPlugin implementation ──

const TRAIL_BLIP_MS = 400;
const TRAIL_BOOM_MS = 650;
const TRAIL_NEWLINE_MS = 350;

// Declare the class type up front so activeInstances can reference it
class RidiculousViewPluginClass {
  decorations: DecorationSet = Decoration.none;
  private view: EditorView;
  private settings: Settings;
  private lastBlipTime = 0;
  private lastBoomTime = 0;

  // Shake state
  private shakeEndAt = 0;
  private shakeTimerId: number | null = null;

  constructor(view: EditorView, settings: Settings) {
    this.view = view;
    this.settings = settings;
    activeInstances.add(this);
  }

  // ── Helpers ──

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

  private static randomGodotColor(): string {
    const r = Math.min(255, Math.round(Math.random() * 510));
    const g = Math.min(255, Math.round(Math.random() * 510));
    const b = Math.min(255, Math.round(Math.random() * 510));
    return `rgb(${Math.min(255, r)}, ${Math.min(255, g)}, ${Math.min(255, b)})`;
  }

  private sanitizeLabel(ch: string): string {
    if (ch === "\n") return "";
    if (ch === "\t") return "\u21B9";
    if (ch.trim() === "") return "SPACE";
    return ch;
  }

  // ── DOM Overlay: Floating Label ──

  private showFloatingLabel(pos: number, text: string, color: string, ttl: number): void {
    const coords = this.view.coordsAtPos(pos);
    if (!coords) return;

    const label = document.createElement("span");
    label.className = "rc-overlay-label";
    label.textContent = text;
    label.style.cssText = `
      position: fixed;
      left: ${coords.left}px;
      top: ${coords.top}px;
      color: ${color};
      font-size: ${this.getEditorFontSizePx()}px;
      font-family: "GravityBold8", "Cascadia Code", "Consolas", monospace;
      font-weight: bold;
      pointer-events: none;
      z-index: 1000;
      transform: translateY(-1.1em) scale(1.6);
      transform-origin: left bottom;
      white-space: nowrap;
    `;
    document.body.appendChild(label);
    track(label);

    const createdAt = Date.now();
    const floatEm = 0.7;
    const scaleAdd = 0.6;

    const tick = () => {
      const age = Date.now() - createdAt;
      const progress = Math.max(0, Math.min(1, age / ttl));
      if (progress >= 1) {
        label.remove();
        untrack(label);
        return;
      }
      const y = -(1.1 + floatEm * progress);
      const s = 1.6 + scaleAdd * progress;
      label.style.transform = `translateY(${y}em) scale(${s})`;
      window.requestAnimationFrame(tick);
    };
    window.requestAnimationFrame(tick);
  }

  // ── DOM Overlay: Sprite Animation ──

  private playSpriteAnim(kind: string, pos: number): void {
    const coords = this.view.coordsAtPos(pos);
    if (!coords) return;
    const data = getSpriteData(kind);
    if (!data) return;

    const img = document.createElement("img");
    img.className = "rc-overlay-sprite";
    img.src = data.frameUris[0];
    img.style.cssText = `
      position: fixed;
      left: ${coords.left}px;
      top: ${coords.top}px;
      pointer-events: none;
      z-index: 1000;
    `;

    // Size and centering per kind
    switch (kind) {
      case "boom":
        img.style.width = "32px"; img.style.height = "32px";
        img.style.marginTop = "-16px"; img.style.marginLeft = "-16px";
        break;
      case "blip":
        img.style.width = "18px"; img.style.height = "18px";
        img.style.marginTop = "-9px"; img.style.marginLeft = "-9px";
        break;
      case "newline":
        img.style.width = "14px"; img.style.height = "14px";
        img.style.marginTop = "-7px"; img.style.marginLeft = "-7px";
        break;
    }

    document.body.appendChild(img);
    track(img);

    let frame = 0;
    const tick = () => {
      frame++;
      if (frame >= data.frameUris.length) {
        img.remove();
        untrack(img);
        return;
      }
      img.src = data.frameUris[frame];
      window.setTimeout(tick, data.frameMs);
    };
    window.setTimeout(tick, data.frameMs);
  }

  // ── Screen Shake ──

  private triggerShake(extendMs: number): void {
    if (!this.settings.shake) return;

    const now = Date.now();
    const maxEnd = now + RATE_LIMITS.MAX_SHAKE_TOTAL_MS;
    this.shakeEndAt = Math.min(
      Math.max(this.shakeEndAt, now + Math.max(extendMs, this.settings.shakeDecayMs)),
      maxEnd
    );

    if (this.shakeTimerId === null) {
      this.startShakeLoop();
    }
  }

  private startShakeLoop(): void {
    const tick = () => {
      if (Date.now() >= this.shakeEndAt) {
        this.shakeTimerId = null;
        this.view.dom.style.transform = "";
        return;
      }
      const amp = this.settings.shakeAmplitude;
      const angle = Math.random() * Math.PI * 2;
      this.view.dom.style.transform = `translate(${Math.round(Math.cos(angle) * amp)}px, ${Math.round(Math.sin(angle) * amp)}px)`;
      this.shakeTimerId = window.setTimeout(tick, RATE_LIMITS.SHAKE_FRAME_MS);
    };
    tick();
  }

  stopShake(): void {
    if (this.shakeTimerId !== null) {
      window.clearTimeout(this.shakeTimerId);
      this.shakeTimerId = null;
    }
    this.shakeEndAt = 0;
    this.view.dom.style.transform = "";
  }

  // ── CM6 ViewPlugin lifecycle ──

  update(update: ViewUpdate): void {
    if (!update.docChanged) return;

    for (const tr of update.transactions) {
      tr.changes.iterChanges(
        (fromA: number, toA: number, _fromB: number, toB: number, inserted: import("@codemirror/state").Text) => {
          const insertedText = inserted.toString();
          const removedLength = toA - fromA;

          if (insertedText.length > 0 && !this.settings.reducedEffects) {
            lastEditWasDelete = false;
            this.handleInsert(toB, insertedText);
          }

          if (removedLength > 0 && !this.settings.reducedEffects) {
            lastEditWasDelete = true;
            this.handleDelete(fromA);
          }
        }
      );
    }
  }

  private handleInsert(pos: number, text: string): void {
    const now = Date.now();
    if (now - this.lastBlipTime < RATE_LIMITS.BLIP_MS) return;
    this.lastBlipTime = now;

    if (this.settings.blips) {
      // Newline effect
      if (text.includes("\n")) {
        this.playSpriteAnim("newline", pos);
      }

      // Blip floating label
      if (this.settings.chars) {
        const charLabel = this.sanitizeLabel(text[0]);
        const color = RidiculousViewPluginClass.randomGodotColor();
        this.showFloatingLabel(pos, charLabel, color, TRAIL_BLIP_MS);
      }

      // Blip sprite
      this.playSpriteAnim("blip", pos);
    }

    if (this.settings.shake) {
      this.triggerShake(text.includes("\n") ? 140 : 120);
    }
  }

  private handleDelete(pos: number): void {
    const now = Date.now();
    if (now - this.lastBoomTime < RATE_LIMITS.BOOM_MS) return;
    this.lastBoomTime = now;

    if (this.settings.explosions) {
      // Boom floating label
      if (this.settings.chars) {
        const color = RidiculousViewPluginClass.randomGodotColor();
        this.showFloatingLabel(pos, "BACKSPACE", color, TRAIL_BOOM_MS);
      }

      // Boom sprite
      this.playSpriteAnim("boom", pos);
    }

    if (this.settings.shake) {
      this.triggerShake(180);
    }
  }

  destroy(): void {
    this.stopShake();
    activeInstances.delete(this);
  }
}

// ── Factory function ──

export function createRidiculousPlugin(settings: Settings) {
  return ViewPlugin.fromClass(
    class extends RidiculousViewPluginClass {
      constructor(view: EditorView) {
        super(view, settings);
      }
    },
    {
      decorations: () => Decoration.none,
    }
  );
}
