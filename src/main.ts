import { Plugin, Editor } from "obsidian";
import { Settings } from "./types";
import { DEFAULT_SETTINGS, PLUGIN_ID, STATUS_BAR_CLASS, PANEL_VIEW_TYPE } from "./constants";
import { XPService } from "./XPService";
import { AudioService } from "./AudioService";
import { RidiculousCodingSettingTab } from "./SettingsTab";
import { RidiculousCodingPanel } from "./ControlPanel";
import { Fireworks } from "./Fireworks";
import { createRidiculousPlugin, clearActiveDecorations } from "./EffectManager";

export default class RidiculousCodingPlugin extends Plugin {
  settings: Settings & { xp?: number; level?: number; xpNextAbs?: number; xpLevelStart?: number };
  xpService!: XPService;
  audioService!: AudioService;
  fireworks!: Fireworks;
  private statusBarItem: HTMLElement | null = null;
  private panel: RidiculousCodingPanel | null = null;

  async onload() {
    await this.loadSettings();

    // Initialize services
    this.xpService = new XPService(this, this.settings.baseXp);
    this.audioService = new AudioService(this);
    this.fireworks = new Fireworks();

    // Configure audio
    await this.audioService.configure();

    // Register CodeMirror extension for decorations
    this.registerCodeMirrorPlugin();

    // Register editor change handler for XP and status bar updates
    this.registerEditorEvents();

    // Status bar
    this.statusBarItem = this.addStatusBarItem();
    this.statusBarItem.addClass(STATUS_BAR_CLASS);
    this.statusBarItem.onclick = () => {
      this.activatePanel();
    };
    this.updateStatusBar();

    // Settings tab
    this.addSettingTab(new RidiculousCodingSettingTab(this.app, this, this.xpService));

    // Register panel view
    this.registerView(PANEL_VIEW_TYPE, (leaf) => {
      this.panel = new RidiculousCodingPanel(
        leaf,
        this.xpService,
        this.settings,
        (key, value) => {
          (this.settings as any)[key] = value;
          this.saveSettings();
        },
        () => {
          this.xpService.reset();
          this.updateStatusBar();
        }
      );
      return this.panel;
    });

    // Commands
    this.addCommand({
      id: "show-panel",
      name: "Show Ridiculous Coding Panel",
      callback: () => this.activatePanel(),
    });

    this.addCommand({
      id: "reset-xp",
      name: "Reset XP",
      callback: () => {
        this.xpService.reset();
        this.updateStatusBar();
        if (this.panel) this.panel.refresh();
      },
    });
  }

  private registerCodeMirrorPlugin(): void {
    const cmExtension = createRidiculousPlugin(this.settings);
    this.registerEditorExtension(cmExtension);
  }

  private registerEditorEvents(): void {
    this.registerEvent(
      this.app.workspace.on("editor-change", (_editor: Editor, _info: any) => {
        // Always award XP (visual effects handled by CM ViewPlugin)
        const leveledUp = this.xpService.addXp(1);
        this.updateStatusBar();
        if (this.panel) this.panel.refresh();

        // Play audio only if effects are enabled
        if (!this.settings.reducedEffects && this.settings.sound) {
          this.audioService.play({ type: "blip", pitch: 1 });
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

    workspace.revealLeaf(leaf);
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
    const saved = await this.loadData();
    this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.xpService.setBaseXp(this.settings.baseXp);
    this.audioService.isEnabled = this.settings.sound;
    this.updateStatusBar();
    if (this.panel) this.panel.refresh();
  }

  onunload() {
    this.audioService.dispose();
    this.fireworks.dispose();
    this.panel = null;
  }
}
