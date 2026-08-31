// Mirrors server STANCE_STYLE — kept small and client-only for rendering.
export const STANCE = {
  PASS:    { fg: '#2fcb8a', bg: 'rgba(47,203,138,0.12)', label: 'PASS' },
  FAIL:    { fg: '#e85c5c', bg: 'rgba(232,92,92,0.12)',  label: 'FAIL' },
  CAUTION: { fg: '#c8922a', bg: 'rgba(200,146,42,0.12)', label: 'CAUTION' },
  BEARISH: { fg: '#e85c5c', bg: 'rgba(232,92,92,0.12)',  label: 'BEAR CASE' },
};

export const VERDICT = {
  BUY:   { fg: '#2fcb8a', bg: 'rgba(47,203,138,0.14)', ring: 'rgba(47,203,138,0.4)' },
  WATCH: { fg: '#c8922a', bg: 'rgba(200,146,42,0.14)', ring: 'rgba(200,146,42,0.4)' },
  SKIP:  { fg: '#e85c5c', bg: 'rgba(232,92,92,0.14)',  ring: 'rgba(232,92,92,0.4)' },
};

export const stanceStyle = (s) => STANCE[s] || STANCE.CAUTION;
export const verdictStyle = (v) => VERDICT[v] || VERDICT.WATCH;
