import { IPlugin } from "./types";

export class XPService {
  private plugin: IPlugin;
  private baseXp: number;
  xp: number = 0;
  level: number = 1;
  xpNextAbs: number;
  xpLevelStart: number = 0;

  constructor(plugin: IPlugin, baseXp: number) {
    this.plugin = plugin;
    this.baseXp = baseXp;
    const saved = plugin.settings;
    this.xp = saved.xp ?? 0;
    this.level = saved.level ?? 1;
    this.xpLevelStart = saved.xpLevelStart ?? 0;
    this.xpNextAbs = saved.xpNextAbs ?? 2 * baseXp;
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
    const data = this.plugin.settings;
    data.xp = this.xp;
    data.level = this.level;
    data.xpNextAbs = this.xpNextAbs;
    data.xpLevelStart = this.xpLevelStart;
    void this.plugin.saveSettings();
  }
}
