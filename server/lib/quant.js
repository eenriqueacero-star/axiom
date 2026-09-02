/**
 * Client for the Axiom quant service (Python/FastAPI, deployed as a 3rd Render
 * service). Degrades gracefully: with no QUANT_URL set, everything reports
 * "not configured" and the app just hides the backtest panel.
 */
const base = () => process.env.QUANT_URL;
const key = () => process.env.QUANT_API_KEY || '';

export const quantReady = () => Boolean(process.env.QUANT_URL);

async function call(path, { method = 'GET', body } = {}) {
  if (!quantReady()) throw new Error('Quant service not configured');
  const r = await fetch(`${base()}${path}`, {
    method,
    headers: { 'x-api-key': key(), ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  const data = text ? JSON.parse(text) : null;
  if (!r.ok) throw new Error(data?.detail || `quant ${r.status}`);
  return data;
}

const cache = new Map();

/** Full rulebook-vs-index backtest. Cached 24h — the underlying data is EOD. */
export async function backtest() {
  const hit = cache.get('bt');
  if (hit && Date.now() - hit.ts < 24 * 60 * 60 * 1000) return hit.data;
  const data = await call('/backtest', { method: 'POST', body: {} });
  cache.set('bt', { ts: Date.now(), data });
  return data;
}

export const holdingsNow = () => call('/holdings-now');

export async function quantStatus() {
  if (!quantReady()) return { configured: false };
  try {
    const h = await call('/health');
    return { configured: true, ...h };
  } catch (e) {
    return { configured: true, ok: false, error: e.message };
  }
}

/** One-line verdict for the council's context, or '' when the service isn't up. */
export async function backtestVerdictLine() {
  if (!quantReady()) return '';
  try {
    const bt = await backtest();
    return bt?.verdict ? `\nBACKTEST (rules-only skeleton of this rulebook, no LLM): ${bt.verdict}\n` : '';
  } catch { return ''; }
}
