import { App } from "obsidian";
import { SoundEvent } from "./types";
import { PLUGIN_ID } from "./constants";

export class AudioService {
  private audioContext: AudioContext | null = null;
  private buffers: Map<string, AudioBuffer> = new Map();
  private app: App;
  isEnabled: boolean = true;

  constructor(app: App) {
    this.app = app;
  }

  async configure(): Promise<void> {
    try {
      this.audioContext = new AudioContext();
      await this.loadSound("blip", "media/sound/blip.wav");
      await this.loadSound("boom", "media/sound/boom.wav");
      await this.loadSound("fireworks", "media/sound/fireworks.wav");
    } catch (e) {
      console.warn("Ridiculous Coding: Audio initialization failed", e);
      this.audioContext = null;
    }
  }

  private async loadSound(name: string, relativePath: string): Promise<void> {
    if (!this.audioContext) return;
    try {
      const vaultPath = `.obsidian/plugins/${PLUGIN_ID}/${relativePath}`;
      const resourceUrl = this.app.vault.adapter.getResourcePath(vaultPath);
      const response = await fetch(resourceUrl);
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await this.audioContext.decodeAudioData(arrayBuffer);
      this.buffers.set(name, audioBuffer);
    } catch (e) {
      console.warn(`Ridiculous Coding: Failed to load sound "${name}"`, e);
    }
  }

  play(event: SoundEvent): void {
    if (!this.isEnabled || !this.audioContext) return;

    // Resume context if suspended (browser autoplay policy)
    if (this.audioContext.state === "suspended") {
      void this.audioContext.resume();
    }

    let bufferName: string;
    let playbackRate: number = 1.0;

    switch (event.type) {
      case "blip":
        bufferName = "blip";
        playbackRate = event.pitch;
        break;
      case "boom":
        bufferName = "boom";
        break;
      case "fireworks":
        bufferName = "fireworks";
        break;
    }

    const buffer = this.buffers.get(bufferName);
    if (!buffer) return;

    const source = this.audioContext.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;

    const gainNode = this.audioContext.createGain();
    gainNode.gain.value = bufferName === "fireworks" ? 0.5 : 0.3;

    source.connect(gainNode);
    gainNode.connect(this.audioContext.destination);
    source.start(0);
  }

  dispose(): void {
    if (this.audioContext) {
      void this.audioContext.close();
      this.audioContext = null;
    }
    this.buffers.clear();
  }
}
