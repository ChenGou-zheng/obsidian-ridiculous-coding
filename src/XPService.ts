import { Settings, XPData } from "./types";

export class XPService {
  private plugin: any; // Obsidian Plugin instance
  private baseXp: number;
  xp: number = 0;
  level: number = 1;
  xpNextAbs: number;
  xpLevelStart: number = 0;

  constructor(plugin: any, baseXp: number) {
    this.plugin = plugin;
    this.baseXp = baseXp;
    const saved = plugin.settings as Settings & XPData;
    this.xp = (saved as any).xp ?? 0;
    this.level = (saved as any).level ?? 1;
    this.xpLevelStart = (saved as any).xpLevelStart ?? 0;
    this.xpNextAbs = (saved as any).xpNextAbs ?? 2 * baseXp;
  }

  get progress(): { current: number; max: number } {
    const max = this.xpNextAbs - this.xpLevelStart;
    return { current: this.xp - this.xpLevelStart, max: Math.max(1, max) };
  }

  addXp(n: number): boolean {
    this.xp += n;
    let leveledUp = false;
    if (this.xp >= this.xpNextAbs) {
      this.level += 1;
      this.xpLevelStart = this.xp;
      this.xpNextAbs = this.xp + Math.round((this.baseXp * this.level) / 10) * 10;
      leveledUp = true;
    }
    this.save();
    return leveledUp;
  }

  reset(): void {
    this.level = 1;
    this.xp = 0;
    this.xpLevelStart = 0;
    this.xpNextAbs = 2 * this.baseXp;
    this.save();
  }

  setBaseXp(base: number): void {
    this.baseXp = base;
    if (this.level <= 1 && this.xp === 0) {
      this.xpNextAbs = 2 * this.baseXp;
    } else if (this.xp >= this.xpNextAbs) {
      this.xpNextAbs = this.xp + Math.round((this.baseXp * this.level) / 10) * 10;
    }
    this.save();
  }

  private save(): void {
    const data = this.plugin.settings as any;
    data.xp = this.xp;
    data.level = this.level;
    data.xpNextAbs = this.xpNextAbs;
    data.xpLevelStart = this.xpLevelStart;
    this.plugin.saveSettings();
  }
}
