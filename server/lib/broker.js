/**
 * Brokerage sync via SnapTrade — PERSONAL API key mode.
 *
 * Personal keys don't register SnapTrade users and don't pass userId/userSecret.
 * The user links their brokers in SnapTrade's own dashboard; we just read.
 * Needs SNAPTRADE_CLIENT_ID + SNAPTRADE_CONSUMER_KEY in the env (Render).
 *
 * Synced accounts land in users/{uid}/accounts/{snaptradeAccountId} with
 * linked:true so the Portfolio tab shows them next to manual accounts.
 */
import { Snaptrade, SnaptradeAuth } from 'snaptrade-typescript-sdk';
import { db } from './firebase.js';

export const brokerReady = Boolean(
  process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY,
);

let _client = null;
function client() {
  if (!brokerReady) throw new Error('Broker linking not configured');
  if (!_client) {
    _client = new Snaptrade({
      auth: SnaptradeAuth.personalApiKey({
        clientId: process.env.SNAPTRADE_CLIENT_ID,
        consumerKey: process.env.SNAPTRADE_CONSUMER_KEY,
      }),
    });
  }
  return _client;
}

const sym = (p) =>
  p?.symbol?.symbol?.symbol ||
  p?.symbol?.symbol?.raw_symbol ||
  p?.instrument?.symbol ||
  p?.instrument?.raw_symbol ||
  p?.symbol?.raw_symbol ||
  (typeof p?.symbol === 'string' ? p.symbol : null);

const costBasis = (p) =>
  Number(
    p?.average_purchase_price ??
    p?.price ??
    p?.tax_lots?.[0]?.price ??
    0,
  ) || 0;

/** Pull holdings for every linked brokerage account into Firestore. */
export async function syncHoldings(uid) {
  const c = client();
  const { data: accounts } = await c.accountInformation.listUserAccounts();

  let synced = 0;
  for (const acct of accounts || []) {
    let positions = [];
    try {
      const { data } = await c.accountInformation.getAllAccountPositions({ accountId: acct.id });
      positions = data?.results || data?.positions || (Array.isArray(data) ? data : []);
    } catch {
      // fall back to legacy holdings endpoint if positions isn't available
      try {
        const { data } = await c.accountInformation.getUserHoldings({ accountId: acct.id });
        positions = data?.positions || [];
      } catch { /* leave empty */ }
    }

    const holdings = {};
    for (const p of positions) {
      const s = sym(p);
      if (!s) continue;
      holdings[String(s).toUpperCase()] = {
        shares: Number(p.units ?? p.fractional_units ?? p.quantity ?? 0),
        costBasis: costBasis(p),
      };
    }

    await db.doc(`users/${uid}/accounts/${acct.id}`).set({
      label: acct.name || acct.institution_name || 'Brokerage',
      sub: acct.institution_name || 'Linked',
      linked: true,
      brokerAccountNumber: acct.number ? String(acct.number).slice(-4) : null,
      holdings,
      order: 100 + synced,
      syncedAt: Date.now(),
    }, { merge: true });
    synced++;
  }
  return synced;
}

export async function brokerStatus(uid) {
  const out = { configured: brokerReady, connections: 0, linkedAccounts: [] };
  if (!brokerReady) return out;
  try {
    const c = client();
    const { data: auths } = await c.connections.listBrokerageAuthorizations();
    out.connections = (auths || []).length;
  } catch { /* ignore */ }
  const linked = await db.collection(`users/${uid}/accounts`).where('linked', '==', true).get();
  out.linkedAccounts = linked.docs.map(d => ({
    id: d.id, label: d.data().label, sub: d.data().sub, syncedAt: d.data().syncedAt,
  }));
  return out;
}
