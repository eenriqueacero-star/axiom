// Every visual decision about the room lives here as a number you can turn.
//
// The point: I can't see the scene and you can. Rather than me guessing and
// redeploying, the leva panel writes to these values live, they persist to
// localStorage, and "copy settings" gives you JSON to hand back so the tuned
// look becomes the new default.

export const DEFAULTS = {
  // camera
  camDistance: 18,
  camHeight: 1.05,     // how steep the isometric angle is
  camZoom: 88,
  camTargetY: 1.0,
  camDrift: 0.4,       // slow idle movement; 0 = locked off

  // room
  roomSize: 13,
  wallHeight: 3.6,
  floorColor: '#3a2c22',
  wallColor: '#232028',
  rugColor: '#2b3440',
  showRug: true,
  showWindow: true,

  // layout
  deskRing: 4.6,
  tableRadius: 1.6,
  seatRing: 2.35,
  agentScale: 0.95,

  // light
  ambient: 0.6,
  ambientColor: '#b9c2d8',
  keyIntensity: 0.9,
  keyColor: '#ffffff',
  pendantIntensity: 6,
  pendantColor: '#ffdcae',
  windowIntensity: 2.6,
  windowColor: '#7ea6ff',

  // atmosphere
  background: '#050507',
  fogNear: 20,
  fogFar: 45,
  bloom: true,
  bloomIntensity: 0.45,
  bloomThreshold: 0.72,
  vignette: 0.66,
};

const KEY = 'axiom.room.settings';

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? { ...DEFAULTS, ...JSON.parse(raw) } : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* ignore */ }
}

export function resetSettings() {
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
}
