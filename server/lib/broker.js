/**
 * Brokerage linking via SnapTrade (Fidelity, Robinhood, etc.).
 * Needs SNAPTRADE_CLIENT_ID + SNAPTRADE_CONSUMER_KEY in the env.
 *
 * Per Axiom user we store { snaptrade: { userId, userSecret } } on users/{uid}.
 * Synced brokerage accounts land in users/{uid}/accounts/{snaptradeAccountId}
 * with linked:true so the portfolio view shows them alongside manual accounts.
 */
import { Snaptrade } from 'snaptrade-typescript-sdk';
import { db } from './firebase.js';

export const brokerReady = Boolean(
  process.env.SNAPTRADE_CLIENT_ID && process.env.SNAPTRADE_CONSUMER_KEY,
);

let _client = null;
function client() {
  if (!brokerReady) throw new Error('Broker linking not configured');
  if (!_client) {
    _client = new Snaptrade({
      clientId: process.env.SNAPTRADE_CLIENT_ID,
      consumerKey: process.env.SNAPTRADE_CONSUMER_KEY,
    });
  }
  return _client;
}

async function creds(uid) {
  const ref = db.doc(`users/${uid}`);
  const snap = await ref.get();
  let st = snap.data()?.snaptrade;
  if (!st?.userSecret) {
    const { data } = await client().authentication.registerSnapTradeUser({ userId: uid });
    st = { userId: data.userId, userSecret: data.userSecret };
    await ref.set({ snaptrade: st }, { merge: true });
  }
  return st;
}

/** URL to SnapTrade's drop-in connection portal (handles creds + MFA). */
export async function connectionLink(uid, redirect) {
  const st = await creds(uid);
  const { data } = await client().authentication.loginSnapTradeUser({
    userId: st.userId,
    userSecret: st.userSecret,
    ...(redirect ? { customRedirect: redirect } : {}),
  });
  return data.redirectURI || data.redirectUri || data;
}

/** Pull holdings for every linked brokerage account into Firestore. */
export async function syncHoldings(uid) {
  const st = await creds(uid);
  const c = client();
  const { data: accounts } = await c.accountInformation.listUserAccounts({
    userId: st.userId, userSecret: st.userSecret,
  });

  let synced = 0;
  for (const acct of accounts || []) {
    const { data: h } = await c.accountInformation.getUserHoldings({
      userId: st.userId, userSecret: st.userSecret, accountId: acct.id,
    });
    const positions = h?.positions || [];
    const holdings = {};
    for (const p of positions) {
      const sym = p.symbol?.symbol?.symbol || p.symbol?.symbol || p.symbol?.raw_symbol;
      if (!sym) continue;
      holdings[String(sym).toUpperCase()] = {
        shares: Number(p.units || p.fractional_units || 0),
        costBasis: Number(p.average_purchase_price || 0),
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
  const snap = await db.doc(`users/${uid}`).get();
  const linked = await db.collection(`users/${uid}/accounts`).where('linked', '==', true).get();
  return {
    configured: brokerReady,
    registered: Boolean(snap.data()?.snaptrade?.userSecret),
    linkedAccounts: linked.docs.map(d => ({
      id: d.id, label: d.data().label, sub: d.data().sub, syncedAt: d.data().syncedAt,
    })),
  };
}
