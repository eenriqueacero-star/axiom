// Mirrors server STANCE_STYLE — kept small and client-only for rendering.
export const STANCE = {
  PASS:    { fg: '#2fcb8a', bg: 'rgba(47,203,138,0.12)', label: 'CLEAR' },
  FAIL:    { fg: '#e85c5c', bg: 'rgba(232,92,92,0.12)',  label: 'FAIL' },
  CAUTION: { fg: '#c8922a', bg: 'rgba(200,146,42,0.12)', label: 'MIXED' },
  BEARISH: { fg: '#e85c5c', bg: 'rgba(232,92,92,0.12)',  label: 'BEAR CASE' },
};

export const VERDICT = {
  ADD:   { fg: '#2fcb8a', bg: 'rgba(47,203,138,0.14)', ring: 'rgba(47,203,138,0.4)' },
  HOLD:  { fg: '#c8922a', bg: 'rgba(200,146,42,0.14)', ring: 'rgba(200,146,42,0.4)' },
  TRIM:  { fg: '#e8922a', bg: 'rgba(232,146,42,0.14)', ring: 'rgba(232,146,42,0.4)' },
  EXIT:  { fg: '#e85c5c', bg: 'rgba(232,92,92,0.14)',  ring: 'rgba(232,92,92,0.4)' },
  // legacy rows
  BUY:   { fg: '#2fcb8a', bg: 'rgba(47,203,138,0.14)', ring: 'rgba(47,203,138,0.4)' },
  WATCH: { fg: '#c8922a', bg: 'rgba(200,146,42,0.14)', ring: 'rgba(200,146,42,0.4)' },
  SKIP:  { fg: '#e85c5c', bg: 'rgba(232,92,92,0.14)',  ring: 'rgba(232,92,92,0.4)' },
};

// Conviction tier — how strongly a name belongs in the long-term basket,
// separate from the ADD/HOLD/TRIM/EXIT action. Set in code by the council.
export const TIER = {
  HIGH:        { fg: '#34d399', label: 'HIGH',  hint: 'Quality compounder — own it, size toward the cap' },
  MEDIUM:      { fg: '#7c8db5', label: 'MED',   hint: 'Solid — hold at a normal weight' },
  LOW:         { fg: '#e0a33a', label: 'LOW',   hint: 'Thin conviction — hold what you have, don’t add' },
  SPECULATIVE: { fg: '#ec7f45', label: 'SPEC',  hint: 'A punt — broken thesis, story stock, or unsizable' },
};
// Tier order, strongest → weakest. Used to sort and to lay out the conviction strip.
export const TIER_ORDER = ['HIGH', 'MEDIUM', 'LOW', 'SPECULATIVE'];

export const stanceStyle = (s) => STANCE[s] || STANCE.CAUTION;
export const verdictStyle = (v) => VERDICT[v] || VERDICT.HOLD;
export const tierStyle = (t) => TIER[t] || null;

// AXIOM sometimes wraps headlines/rationale in markdown. We render plain text,
// so strip the inline markers (**bold**, *italic*, `code`, leading #/>).
export const stripMd = (s) =>
  typeof s === 'string'
    ? s
        .replace(/\*\*(.+?)\*\*/g, '$1')
        .replace(/(?<!\*)\*(?!\*)([^*]+?)\*(?!\*)/g, '$1')
        .replace(/`([^`]+)`/g, '$1')
        .replace(/^\s*#{1,6}\s+/gm, '')
        .replace(/^\s*>\s?/gm, '')
        .trim()
    : s;
