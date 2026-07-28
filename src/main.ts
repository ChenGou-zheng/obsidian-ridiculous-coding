import { Plugin, Editor, requestUrl } from "obsidian";
import { Settings } from "./types";
import { DEFAULT_SETTINGS, STATUS_BAR_CLASS, PANEL_VIEW_TYPE, PLUGIN_ID } from "./constants";
import { XPService } from "./XPService";
import { AudioService } from "./AudioService";
import { RidiculousCodingSettingTab } from "./SettingsTab";
import { RidiculousCodingPanel } from "./ControlPanel";
import { Fireworks } from "./Fireworks";
import { createRidiculousPlugin, clearActiveDecorations, setFontBase64, loadSpriteData, wasLastEditDelete } from "./EffectManager";

export default class RidiculousCodingPlugin extends Plugin {
  settings: Settings & { xp?: number; level?: number; xpNextAbs?: number; xpLevelStart?: number };
  xpService!: XPService;
  audioService!: AudioService;
  fireworks!: Fireworks;
  private statusBarItem: HTMLElement | null = null;
  private pitchIncrease = 0;
  private pitchResetTimer: number | null = null;
  private oldReducedEffects = false;
  private static readonly PITCH_RESET_MS = 180;

  private getPanel(): RidiculousCodingPanel | null {
    return (this.app.workspace.getLeavesOfType(PANEL_VIEW_TYPE)[0]?.view as RidiculousCodingPanel) ?? null;
  }

  async onload() {
    await this.loadSettings();

    // Initialize services
    this.xpService = new XPService(this, this.settings.baseXp);
    this.audioService = new AudioService(this.app);
    this.fireworks = new Fireworks();

    // Configure audio
    await this.audioService.configure();

    // Load GravityBold8 font for blip text SVG rendering
    try {
      const fontPath = this.app.vault.adapter.getResourcePath(
        `.obsidian/plugins/${PLUGIN_ID}/media/font/GravityBold8.ttf`
      );
      const resp = await requestUrl({ url: fontPath });
      const bytes = new Uint8Array(resp.arrayBuffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      setFontBase64(btoa(binary));
    } catch {
      console.warn("Ridiculous Coding: Failed to load font, falling back to monospace");
    }

    // Load sprite sheet data for animated icons (blip/boom/newline)
    try {
      await Promise.all([
        loadSpriteData(this.app, "blip"),
        loadSpriteData(this.app, "boom"),
        loadSpriteData(this.app, "newline"),
      ]);
    } catch (e) {
      console.warn("Ridiculous Coding: Failed to load sprite data, falling back to static SVG icons", e);
    }

    // Register CodeMirror extension for decorations
    this.registerCodeMirrorPlugin();

    // Register editor change handler for XP and status bar updates
    this.registerEditorEvents();

    // Status bar
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.addClass(STATUS_BAR_CLASS);
    this.statusBarItem.onclick = () => {
      void this.activatePanel();
    };
    this.updateStatusBar();

    // Ribbon icon
    this.addRibbonIcon("rocket", "Ridiculous Coding", () => this.activatePanel());

    // Settings tab
    this.addSettingTab(new RidiculousCodingSettingTab(this.app, this, this.xpService));

    // Register panel view
    this.registerView(PANEL_VIEW_TYPE, (leaf) =>
      new RidiculousCodingPanel(
        leaf,
        this.xpService,
        this.settings,
        (key, value) => {
          (this.settings as Record<string, any>)[key] = value;
          void this.saveSettings();
        },
        () => {
          this.xpService.reset();
          this.updateStatusBar();
        }
      )
    );

    // Commands
    this.addCommand({
      id: "show-panel",
      name: "Show Panel",
      callback: () => this.activatePanel(),
    });

    this.addCommand({
      id: "reset-xp",
      name: "Reset XP",
      callback: () => {
        this.xpService.reset();
        this.updateStatusBar();
        this.getPanel()?.refresh();
      },
    });
    
    this.oldReducedEffects = this.settings.reducedEffects;
  }

  private registerCodeMirrorPlugin(): void {
    const cmExtension = createRidiculousPlugin(this.settings);
    this.registerEditorExtension(cmExtension);
  }

  private registerEditorEvents(): void {
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor: Editor, _info: unknown) => {
        // Always award XP (visual effects handled by CM ViewPlugin)
        const leveledUp = this.xpService.addXp(1);
        this.updateStatusBar();
        this.getPanel()?.refresh();

        // Dynamic pitch — increases with rapid typing, resets after pause
        this.pitchIncrease += 1.0;
        if (this.pitchResetTimer) window.clearTimeout(this.pitchResetTimer);
        this.pitchResetTimer = window.setTimeout(
          () => { this.pitchIncrease = 0; },
          RidiculousCodingPlugin.PITCH_RESET_MS
        );
        const pitch = 1.0 + Math.min(20, this.pitchIncrease) * 0.05;

        // Play audio only if effects are enabled
        if (!this.settings.reducedEffects && this.settings.sound) {
          if (wasLastEditDelete()) {
            this.audioService.play({ type: "boom" });
          } else {
            this.audioService.play({ type: "blip", pitch });
          }
        }

        // Trigger fireworks on level-up (visual + audio)
        if (leveledUp && !this.settings.reducedEffects && this.settings.fireworks) {
          this.fireworks.show();
          this.audioService.play({ type: "fireworks" });
        }
      })
    );
  }

  async activatePanel() {
    const { workspace } = this.app;

    let leaf = workspace.getLeavesOfType(PANEL_VIEW_TYPE)[0];
    if (!leaf) {
      const rightLeaf = workspace.getRightLeaf(false);
      if (!rightLeaf) return;
      leaf = rightLeaf;
      await leaf.setViewState({ type: PANEL_VIEW_TYPE, active: true });
    }

    workspace.setActiveLeaf(leaf);
  }

  updateStatusBar(): void {
    if (!this.settings.enableStatusBar || !this.statusBarItem) return;

    const prog = this.xpService.progress;
    this.statusBarItem.setText(`RC Lv ${this.xpService.level} — ${prog.current}/${prog.max} XP`);
    this.statusBarItem.setAttr("aria-label", `Ridiculous Coding - Level ${this.xpService.level}`);
  }

  clearAllDecorations(): void {
    clearActiveDecorations();
  }

  async loadSettings() {
    const saved = await this.loadData() as Record<string, any>;
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.xpService.setBaseXp(this.settings.baseXp);
    this.audioService.isEnabled = this.settings.sound;
    this.updateStatusBar();
    this.getPanel()?.refresh();

    // Clear existing decorations when reduced effects is enabled
    if (!this.oldReducedEffects && this.settings.reducedEffects) {
      this.clearAllDecorations();
    }
    this.oldReducedEffects = this.settings.reducedEffects;
  }

  onunload() {
    this.clearAllDecorations();
    this.audioService.dispose();
    this.fireworks.dispose();
  }
}
