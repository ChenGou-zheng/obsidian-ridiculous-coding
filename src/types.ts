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

