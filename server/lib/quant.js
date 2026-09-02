/**
 * Backtest data for the app. Two modes:
 *  1. Static (default): a result file committed to the repo
 *     (server/data/backtest.json), refreshed by running `quant/run_axiom.py`
 *     locally every month or so. No extra service, no cost.
 *  2. Live: if QUANT_URL is set, proxy the Python quant service for on-demand
 *     re-runs and /holdings-now.
 */
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const STATIC_PATH = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'backtest.json');

const base = () => process.env.QUANT_URL;
const key = () => process.env.QUANT_API_KEY || '';

export const quantReady = () => Boolean(process.env.QUANT_URL);

async function staticBacktest() {
  const raw = await readFile(STATIC_PATH, 'utf8');
  return { ...JSON.parse(raw), source: 'static' };
}

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

/** Rulebook-vs-index backtest — live service if configured, else the committed file. */
export async function backtest() {
  const hit = cache.get('bt');
  if (hit && Date.now() - hit.ts < 24 * 60 * 60 * 1000) return hit.data;
  let data;
  if (quantReady()) {
    try { data = await call('/backtest', { method: 'POST', body: {} }); }
    catch { data = await staticBacktest(); }
  } else {
    data = await staticBacktest();
  }
  cache.set('bt', { ts: Date.now(), data });
  return data;
}

export const holdingsNow = () => call('/holdings-now'); // live service only

export async function quantStatus() {
  if (!quantReady()) {
    try {
      const s = await staticBacktest();
      return { configured: true, static: true, generatedAt: s.generatedAt };
    } catch {
      return { configured: false };
    }
  }
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
