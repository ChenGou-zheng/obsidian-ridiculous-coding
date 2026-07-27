export interface Settings {
  blips: boolean;
  explosions: boolean;
  chars: boolean;
  shake: boolean;
  shakeAmplitude: number;
  sound: boolean;
  fireworks: boolean;
  baseXp: number;
  enableStatusBar: boolean;
  reducedEffects: boolean;
}

export interface XPData {
  xp: number;
  level: number;
  xpNextAbs: number;
  xpLevelStart: number;
}

export type SoundEvent =
  | { type: "blip"; pitch: number }
  | { type: "boom" }
  | { type: "fireworks" };

export interface EditorChangeInfo {
  insertedText: string;
  removedLength: number;
  isInsert: boolean;
  isDelete: boolean;
  hasNewline: boolean;
}

export type PanelMessageFromExt =
  | { type: "state"; xp: number; level: number; xpNext: number; xpLevelStart: number }
  | { type: "fireworks" }
  | { type: "settings"; settings: Settings };

export type PanelMessageToExt =
  | { type: "ready" }
  | { type: "toggle"; key: keyof Settings; value: boolean }
  | { type: "resetXp" };
