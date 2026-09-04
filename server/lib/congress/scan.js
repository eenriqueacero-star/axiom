/**
 * Daily: check for fresh congressional trades in names each user holds, push
 * once, drop them into the shared `signals` feed (kind: 'congress'), and hand
 * each one to the event desk (triageSignal) so the boss can act/talk/archive
 * it like any other material event. Dormant unless a provider key is set.
 */
import { db } from '../firebase.js';
import { getPortfolio } from '../portfolio.js';
import { notify } from '../notify.js';
import { congressTrades, congressConfigured } from './index.js';
import { triageSignal } from '../desk/triage.js';

const SEEN_CAP = 400;

function heldTickers(portfolio) {
  const s = new Set();
  for (const a of portfolio?.accounts || []) {
    for (const p of a.positions || []) if ((p.shares || 0) > 0) s.add(p.ticker);
  }
  return [...s];
}

export async function scanCongressForHoldings() {
  if (!congressConfigured()) return 0;

  const recent = await congressTrades({ days: 21 }).catch(() => []);
  if (!recent.length) return 0;

  let uids = [];
  try { uids = (await db.collection('users').get()).docs.map(d => d.id); } catch { return 0; }

  let alerted = 0;
  for (const uid of uids) {
    let portfolio;
    try { portfolio = await getPortfolio(uid); } catch { continue; }
    const held = new Set(heldTickers(portfolio));
    if (!held.size) continue;

    const hits = recent.filter(t => held.has(t.ticker));
    if (!hits.length) continue;

    const seenRef = db.doc(`users/${uid}/state/congressSeen`);
    const seen = new Set((await seenRef.get().catch(() => null))?.data()?.ids || []);
    const fresh = [];

    for (const t of hits) {
      if (seen.has(t.id)) continue;
      fresh.push(t.id);
      alerted++;
      const amt = t.amountLow ? `$${(t.amountLow / 1000).toFixed(0)}k–${(t.amountHigh / 1000).toFixed(0)}k` : '';
      const headline = `${t.member} (${t.chamber}) ${t.type === 'buy' ? 'bought' : 'sold'} ${t.ticker} — ${amt}`;
      const sig = await db.collection(`users/${uid}/signals`).add({
        ticker: t.ticker, kind: 'congress',
        headline,
        url: t.url || '', source: t.source || 'Congress',
        ts: new Date(t.txDate).getTime() || Date.now(),
        material: true, thesis: false, seenAt: Date.now(),
      }).catch(() => null);
      await notify(uid, {
        kind: 'congress', severity: 'fyi', ticker: t.ticker,
        title: `${t.member} ${t.type === 'buy' ? 'bought' : 'sold'} ${t.ticker}`,
        body: `${t.chamber}${t.party ? ` · ${t.party}` : ''} · ${amt} · traded ${t.txDate}`,
        url: t.url || null,
        refKind: sig ? 'signal' : null, refId: sig?.id || null,
      });

      // Hand it to the boss too — a sizable buy/sell in a held name is exactly
      // the kind of thing the event desk should weigh in on, not just a push.
      await triageSignal(uid, { ticker: t.ticker, headline, source: t.source || 'Congress', url: t.url || '' })
        .catch((e) => console.error('[event-desk] from congress:', e.message));
    }

    if (fresh.length) {
      await seenRef.set({ ids: [...seen, ...fresh].slice(-SEEN_CAP), updatedAt: Date.now() }).catch(() => {});
    }
  }
  if (alerted) console.log(`[congress] ${alerted} holdings trades alerted`);
  return alerted;
}
