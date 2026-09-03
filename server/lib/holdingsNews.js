/**
 * Proactive holdings news — the "don't miss something in your own book" edge.
 * Every 30 min in market hours (+ an after-close sweep): scan each holding's
 * fresh headlines, SEC 8-K filings, and insider (Form 4) activity. Push the
 * material ones to the investor immediately, and hand the serious ones to the
 * event desk (lib/desk/triage.js) — the boss decides whether to put the
 * analysts to work, talk it through, or file it.
 */
import { db } from './firebase.js';
import { getPortfolio } from './portfolio.js';
import { tickerNews } from './signals.js';
import { recentFilings, edgarConfigured } from './edgar.js';
import { insiderActivity, insiderHeadline } from './insiders.js';
import { triageSignal } from './desk/triage.js';
import { sendPush } from '../routes/push.js';

// Words that tend to mean a real change to the story, not noise.
const MATERIAL = /\b(acqui|merger|buyout|takeover|to acquire|acquires|acquired|guidance|cuts? outlook|lowers? outlook|profit warning|downgrade[sd]?|upgrade[sd]?|SEC (?:probe|investigat|charge)|lawsuit|sued|fraud|accounting|restat|recall|bankrupt|chapter 11|CEO (?:steps down|resign|fired|out)|CFO (?:steps down|resign)|delist|short seller|halts? trading|data breach|antitrust|FTC|DOJ|tariff|export (?:ban|control)|earnings (?:beat|miss)|raises? guidance|record (?:revenue|quarter))\b/i;
// A tighter set — these go to the boss, not just a ping.
const THESIS = /\b(acqui|merger|buyout|takeover|guidance|profit warning|SEC (?:probe|investigat|charge)|fraud|accounting|restat|bankrupt|chapter 11|CEO (?:steps down|resign|fired)|delist|antitrust|export (?:ban|control))\b/i;

const RECENT_MS = 100 * 60 * 1000;      // one cron cycle + margin
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

  const now = Date.now();
  let alerted = 0;
  const newlySeen = [];
  const toTriage = [];   // the serious events — handed to the boss after dedup is saved

  const signal = async (sig) => {
    await db.collection(`users/${uid}/signals`).add({ ...sig, seenAt: now }).catch(() => {});
  };

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
      await signal({ ticker, kind: 'news', headline: n.headline, url: n.url || '', source: n.source || '', ts: n.ts || now, material: true, thesis: thesisLevel });

      if (thesisLevel) toTriage.push({ ticker, kind: 'news', headline: n.headline, url: n.url || '', source: n.source || 'news', thesis: true });
    }

    // SEC 8-K filings — the company's own disclosure. Often leads the headlines.
    if (edgarConfigured()) {
      let filings = [];
      try { filings = await recentFilings(ticker, { days: 2 }); } catch { filings = []; }
      for (const f of filings) {
        if (seen.has(f.accession)) continue;
        newlySeen.push(f.accession);
        alerted++;
        const what = f.itemLabels.length ? f.itemLabels.join('; ') : 'a material event';

        await sendPush(uid, {
          title: `📄 ${ticker} filed an ${f.form}`,
          body: `${ticker} ${what}`.slice(0, 140),
          data: { ticker, url: f.url },
        }).catch(() => {});
        await signal({ ticker, kind: 'filing', headline: `${f.form}: ${ticker} ${what}`, url: f.url || '', source: 'SEC EDGAR', ts: f.filedAt || now, material: true, thesis: !!f.thesis });

        if (f.thesis) toTriage.push({ ticker, kind: 'filing', headline: `${ticker} ${what} (${f.form})`, url: f.url || '', source: 'SEC EDGAR', thesis: true });
      }
    }

    // Insider (Form 4) cluster buying / selling — once a week per direction.
    try {
      const ia = await insiderActivity(ticker, { days: 45 });
      if (ia && (ia.clusterBuy || ia.clusterSell)) {
        const wk = Math.floor(now / (7 * 864e5));
        const key = `insider-${ia.clusterBuy ? 'buy' : 'sell'}-${ticker}-${wk}`;
        if (!seen.has(key)) {
          newlySeen.push(key);
          alerted++;
          const head = insiderHeadline(ia);
          await sendPush(uid, {
            title: `${ia.clusterBuy ? '🟢' : '🟠'} ${ticker} insiders`,
            body: head.slice(0, 140),
            data: { ticker },
          }).catch(() => {});
          await signal({ ticker, kind: 'insider', headline: head, url: '', source: 'SEC Form 4', ts: now, material: true, thesis: false });
          // A cluster buy is worth the boss's attention; heavy selling too.
          toTriage.push({ ticker, kind: 'insider', headline: head, url: '', source: 'SEC Form 4', thesis: ia.clusterBuy });
        }
      }
    } catch { /* non-fatal */ }

    await new Promise(r => setTimeout(r, 300));
  }

  if (newlySeen.length) {
    const ids = [...seen, ...newlySeen].slice(-SEEN_CAP);
    await seenRef.set({ ids, updatedAt: now }).catch(() => {});
  }

  // Hand the serious events to the boss — ONE AT A TIME. A scan cycle often
  // produces two signals for the same ticker (a headline + its 8-K); firing
  // them in parallel raced past the per-ticker cooldown and doubled the spend.
  (async () => {
    for (const sig of toTriage) {
      await triageSignal(uid, sig).catch((e) => console.error('[event-desk] from news:', e.message));
    }
  })();

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
