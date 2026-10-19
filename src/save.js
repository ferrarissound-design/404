// 自動保存・設定
const SAVE_KEY = 'room404.save.v1';
const SET_KEY = 'room404.settings.v1';

export const DEFAULT_SETTINGS = {
  master: 0.85,
  amb: 1,
  sfx: 1,
  sens: 1,
  quality: 'auto',
  reduceFlicker: false,
  haptic: true,
  invertY: false,
  seenIntro: false,
  endings: {},
};

function get(key) {
  try {
    const s = localStorage.getItem(key);
    return s ? JSON.parse(s) : null;
  } catch (e) {
    return null;
  }
}
function set(key, v) {
  try {
    localStorage.setItem(key, JSON.stringify(v));
    return true;
  } catch (e) {
    return false;
  }
}

export const loadSave = () => {
  const s = get(SAVE_KEY);
  return s && s.v === 1 ? s : null;
};
export const writeSave = (data) => set(SAVE_KEY, { v: 1, savedAt: Date.now(), ...data });
export const clearSave = () => {
  try {
    localStorage.removeItem(SAVE_KEY);
  } catch (e) {}
};
export const loadSettings = () => ({ ...DEFAULT_SETTINGS, ...(get(SET_KEY) || {}) });
export const writeSettings = (s) => set(SET_KEY, s);
