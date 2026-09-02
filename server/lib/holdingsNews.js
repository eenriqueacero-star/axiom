/**
 * Proactive holdings news — the "don't miss something in your own book" edge.
 * Every 30 min in market hours: scan each holding's fresh headlines, flag the
 * material ones (acquisitions, guidance cuts, fraud, regulatory, management),
 * push once, and re-run the council when it looks thesis-relevant.
 */
import { db } from './firebase.js';
import { getPortfolio } from './portfolio.js';
import { tickerNews } from './signals.js';
import { runCouncil } from './council.js';
import { sendPush } from '../routes/push.js';

// Words that tend to mean a real change to the story, not noise.
const MATERIAL = /\b(acqui|merger|buyout|takeover|to acquire|acquires|acquired|guidance|cuts? outlook|lowers? outlook|profit warning|downgrade[sd]?|upgrade[sd]?|SEC (?:probe|investigat|charge)|lawsuit|sued|fraud|accounting|restat|recall|bankrupt|chapter 11|CEO (?:steps down|resign|fired|out)|CFO (?:steps down|resign)|delist|short seller|halts? trading|data breach|antitrust|FTC|DOJ|tariff|export (?:ban|control)|earnings (?:beat|miss)|raises? guidance|record (?:revenue|quarter))\b/i;
// A tighter set that justifies a full re-review, not just a ping.
const THESIS = /\b(acqui|merger|buyout|takeover|guidance|profit warning|SEC (?:probe|investigat|charge)|fraud|accounting|restat|bankrupt|chapter 11|CEO (?:steps down|resign|fired)|delist|antitrust|export (?:ban|control))\b/i;

const RECENT_MS = 100 * 60 * 1000;      // one cron cycle + margin
const REVIEW_COOLDOWN_MS = 4 * 60 * 60 * 1000;
const SEEN_CAP = 250;

function heldTickers(portfolio) {
  const s = new Set();
  for (const a of portfolio?.accounts || []) {
    for (const p of a.positions || []) if ((p.shares || 0) > 0) s.add(p.ticker);
  }
  return [...s];
}

export async function scanHoldingsNewsForUser(uid) {
  let portfolio;
  try { portfolio = await getPortfolio(uid); } catch { return 0; }
  const tickers = heldTickers(portfolio);
  if (!tickers.length) return 0;

  const seenRef = db.doc(`users/${uid}/state/newsSeen`);
  const seen = new Set((await seenRef.get().catch(() => null))?.data()?.ids || []);
  const analysesCol = db.collection(`users/${uid}/analyses`);

  const now = Date.now();
  let alerted = 0;
  const newlySeen = [];

  for (const ticker of tickers) {
    let news = [];
    try { news = await tickerNews(ticker, { days: 1, limit: 10 }); } catch { continue; }

    for (const n of news) {
      if (!n.headline || seen.has(n.id)) continue;
      if (now - (n.ts || 0) > RECENT_MS) continue;
      if (!MATERIAL.test(n.headline)) continue;

      newlySeen.push(n.id);
      alerted++;

      const thesisLevel = THESIS.test(n.headline);
      await sendPush(uid, {
        title: `📰 ${ticker} — ${thesisLevel ? 'material news' : 'news'}`,
        body: n.headline.slice(0, 140),
        data: { ticker, url: n.url },
      }).catch(() => {});

      // Persist to a real feed collection (for a future holdings news view).
      await db.collection(`users/${uid}/signals`).add({
        ticker, headline: n.headline, url: n.url || '', source: n.source || '',
        ts: n.ts || now, material: true, thesis: thesisLevel, seenAt: now,
      }).catch(() => {});

      // Thesis-relevant + no fresh run → re-convene the council.
      if (thesisLevel) {
        try {
          const snap = await analysesCol.where('ticker', '==', ticker).get();
          const latest = snap.docs.map(d => d.data()).sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
          if (!latest || now - (latest.ts || 0) > REVIEW_COOLDOWN_MS) {
            const result = await runCouncil(ticker, { mode: 'scout', uid });
            await analysesCol.add(result);
            await sendPush(uid, {
              title: `${ticker} re-reviewed after the news`,
              body: `${result.verdict} ${result.conviction}/10${result.headline ? ` · ${result.headline}` : ''}`,
              data: { ticker, verdict: result.verdict },
            }).catch(() => {});
          }
        } catch { /* non-fatal */ }
      }
    }
    await new Promise(r => setTimeout(r, 300));
  }

  if (newlySeen.length) {
    const ids = [...seen, ...newlySeen].slice(-SEEN_CAP);
    await seenRef.set({ ids, updatedAt: now }).catch(() => {});
  }
  return alerted;
}

/** Every user (cron). */
export async function scanAllHoldingsNews() {
  let uids = [];
  try { uids = (await db.collection('users').get()).docs.map(d => d.id); } catch { return 0; }
  let total = 0;
  for (const uid of uids) total += await scanHoldingsNewsForUser(uid).catch(() => 0);
  if (total) console.log(`[holdings-news] ${total} material headlines alerted`);
  return total;
}
