/**
 * AUTO-tier agent actions — reversible, low-stakes things the boss or an
 * analyst can just DO mid-conversation instead of only describing, with a
 * plain-language receipt appended to the reply. Real trades and portfolio
 * edits are never in this registry — those stay CONFIRM-only (unbuilt) or
 * fully manual.
 *
 * Directive syntax the model emits, one per reply, on its own line at the
 * very end: [[do: <name> <arg>]] — e.g. [[do: watchlist_add NVDA]]
 */
import { addToWatchlist, removeFromWatchlist } from './watchlist.js';

const REGISTRY = {
  watchlist_add: {
    exec: (uid, arg) => addToWatchlist(uid, arg),
    receipt: (r) => `Added ${r.ticker} to your watchlist.`,
  },
  watchlist_remove: {
    exec: (uid, arg) => removeFromWatchlist(uid, arg),
    receipt: (r) => `Removed ${r.ticker} from your watchlist.`,
  },
};

export const ACTION_NAMES = Object.keys(REGISTRY);

/**
 * Finds one trailing [[do: name arg]] directive, executes it against the
 * registry, and returns { text, receipt }. `text` always has the directive
 * stripped (even on failure — never leak the raw directive to the user);
 * `receipt` is a short confirmation sentence to append, or null.
 */
export async function parseAndExecuteAction(text, uid) {
  const raw = String(text || '');
  const m = raw.match(/\[\[do:\s*([a-z_]+)(?:\s+([^\]]+))?\]\]\s*$/i);
  if (!m) return { text: raw.trim(), receipt: null };

  const cleaned = raw.slice(0, m.index).trim() || raw.trim();
  const name = m[1].toLowerCase();
  const arg = (m[2] || '').trim();
  const entry = REGISTRY[name];
  if (!entry) return { text: cleaned, receipt: null };

  try {
    const r = await entry.exec(uid, arg);
    if (!r?.ok) return { text: cleaned, receipt: null };
    return { text: cleaned, receipt: entry.receipt(r) };
  } catch {
    return { text: cleaned, receipt: null };
  }
}
