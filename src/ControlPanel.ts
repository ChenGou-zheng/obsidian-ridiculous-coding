import { ItemView, WorkspaceLeaf } from "obsidian";
import { Settings } from "./types";
import { XPService } from "./XPService";
import { PANEL_VIEW_TYPE } from "./constants";

export class RidiculousCodingPanel extends ItemView {
  private xpService: XPService;
  private settings: Settings;
  private onToggle: (key: keyof Settings, value: boolean) => void;
  private onResetXp: () => void;

  constructor(
    leaf: WorkspaceLeaf,
    xpService: XPService,
    settings: Settings,
    onToggle: (key: keyof Settings, value: boolean) => void,
    onResetXp: () => void
  ) {
    super(leaf);
    this.xpService = xpService;
    this.settings = settings;
    this.onToggle = onToggle;
    this.onResetXp = onResetXp;
  }

  getViewType(): string {
    return PANEL_VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Ridiculous Coding";
  }

  getIcon(): string {
    return "rocket";
  }

  async onOpen(): Promise<void> {
    this.render();
  }

  render(): void {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("ridiculous-coding-panel");

    // Level display
    container.createEl("h3", { text: `🚀 Level ${this.xpService.level}` });

    // XP Progress
    const prog = this.xpService.progress;
    const progressContainer = container.createDiv({ cls: "progress-bar" });
    const progressFill = progressContainer.createDiv({ cls: "progress-bar-fill" });
    progressFill.style.width = `${(prog.current / prog.max) * 100}%`;

    const xpText = container.createDiv({ cls: "xp-text" });
    xpText.setText(`${prog.current} / ${prog.max} XP`);

    container.createEl("hr");

    // Toggle rows
    this.addToggle(container, "Blips", this.settings.blips, (v) => {
      this.settings.blips = v;
      this.onToggle("blips", v);
    });
    this.addToggle(container, "Explosions", this.settings.explosions, (v) => {
      this.settings.explosions = v;
      this.onToggle("explosions", v);
    });
    this.addToggle(container, "Shake", this.settings.shake, (v) => {
      this.settings.shake = v;
      this.onToggle("shake", v);
    });
    this.addToggle(container, "Sound", this.settings.sound, (v) => {
      this.settings.sound = v;
      this.onToggle("sound", v);
    });
    this.addToggle(container, "Reduced Effects", this.settings.reducedEffects, (v) => {
      this.settings.reducedEffects = v;
      this.onToggle("reducedEffects", v);
    });

    container.createEl("hr");

    // Reset button
    const resetBtn = container.createEl("button", { text: "Reset XP" });
    resetBtn.addEventListener("click", () => {
      this.onResetXp();
      this.render();
    });
  }

  private addToggle(
    container: HTMLElement,
    label: string,
    value: boolean,
    onChange: (value: boolean) => void
  ): void {
    const row = container.createDiv({ cls: "toggle-row" });
    row.createSpan({ text: label });

    const toggle = row.createEl("input", { type: "checkbox" });
    toggle.checked = value;
    toggle.addEventListener("change", () => {
      onChange(toggle.checked);
    });
  }

  refresh(): void {
    this.render();
  }

  async onClose(): Promise<void> {
    // Cleanup
  }
}
