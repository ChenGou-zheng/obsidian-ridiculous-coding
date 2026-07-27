import { App, PluginSettingTab, Setting } from "obsidian";
import { Settings } from "./types";
import { XPService } from "./XPService";

export class RidiculousCodingSettingTab extends PluginSettingTab {
  private plugin: any;
  private xpService: XPService;

  constructor(app: App, plugin: any, xpService: XPService) {
    super(app, plugin);
    this.plugin = plugin;
    this.xpService = xpService;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Ridiculous Coding" });

    new Setting(containerEl)
      .setName("Blip effects")
      .setDesc("Show animations when typing characters")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.blips)
          .onChange(async (value) => {
            this.plugin.settings.blips = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Explosion effects")
      .setDesc("Show boom effects when deleting")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.explosions)
          .onChange(async (value) => {
            this.plugin.settings.explosions = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Character labels")
      .setDesc("Overlay the typed character label with effects")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.chars)
          .onChange(async (value) => {
            this.plugin.settings.chars = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Screen shake")
      .setDesc("Enable screen shake effects")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.shake)
          .onChange(async (value) => {
            this.plugin.settings.shake = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Shake amplitude")
      .setDesc("Maximum shake displacement in pixels (0-32)")
      .addSlider((slider) =>
        slider
          .setLimits(0, 32, 1)
          .setValue(this.plugin.settings.shakeAmplitude)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.shakeAmplitude = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Sound effects")
      .setDesc("Play sounds for blips, booms, and fireworks")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.sound)
          .onChange(async (value) => {
            this.plugin.settings.sound = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Fireworks")
      .setDesc("Celebrate level-ups with fireworks animation")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.fireworks)
          .onChange(async (value) => {
            this.plugin.settings.fireworks = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Base XP")
      .setDesc("Base XP value used in level-up curve (10-200)")
      .addSlider((slider) =>
        slider
          .setLimits(10, 200, 5)
          .setValue(this.plugin.settings.baseXp)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.baseXp = value;
            this.xpService.setBaseXp(value);
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Status bar")
      .setDesc("Show level and XP progress in the status bar")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableStatusBar)
          .onChange(async (value) => {
            this.plugin.settings.enableStatusBar = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Reduced effects mode")
      .setDesc("Disable all visual effects and sounds for accessibility. XP system still works.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.reducedEffects)
          .onChange(async (value) => {
            this.plugin.settings.reducedEffects = value;
            await this.plugin.saveSettings();
            if (value) {
              // Clear all decorations
              this.plugin.clearAllDecorations?.();
            }
          })
      );

    containerEl.createEl("hr");

    new Setting(containerEl)
      .setName("Reset XP")
      .setDesc("Reset your experience points and level back to 1")
      .addButton((button) =>
        button
          .setButtonText("Reset")
          .setWarning()
          .onClick(() => {
            this.xpService.reset();
            this.plugin.updateStatusBar?.();
            button.setButtonText("Reset ✓");
            setTimeout(() => button.setButtonText("Reset"), 2000);
          })
      );
  }
}
