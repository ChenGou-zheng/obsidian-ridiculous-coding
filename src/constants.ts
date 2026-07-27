import { Settings } from "./types";

export const DEFAULT_SETTINGS: Settings = {
  blips: true,
  explosions: true,
  chars: true,
  shake: true,
  shakeAmplitude: 6,
  sound: true,
  fireworks: true,
  baseXp: 50,
  enableStatusBar: true,
  reducedEffects: false,
};

export const RATE_LIMITS = {
  BLIP_MS: 20,
  BOOM_MS: 100,
  MAX_DECORATIONS_PER_TYPE: 5,
  MAX_SHAKE_TOTAL_MS: 400,
  SHAKE_FRAME_MS: 50,
} as const;

export const XP_FORMULA = {
  BASE_XP: 50,
} as const;

export const PLUGIN_ID = "ridiculous-coding";
export const STATUS_BAR_CLASS = "ridiculous-coding-status-bar";
export const PANEL_VIEW_TYPE = "ridiculous-coding-panel";
export const FIREWORKS_CLASS = "ridiculous-coding-fireworks";
