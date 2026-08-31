import { useEffect, useState } from 'react';
import { getBrokerStatus, connectBroker, syncBroker } from '../api';

export default function BrokerLink({ onSynced }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  const load = () => getBrokerStatus().then(setStatus).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  // Returned from the SnapTrade portal? sync automatically.
  useEffect(() => {
    if (new URLSearchParams(location.search).get('brokerLinked')) {
      history.replaceState(null, '', location.pathname);
      sync();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const connect = async () => {
    setBusy('connect'); setErr('');
    try {
      const { redirectURI } = await connectBroker(`${location.origin}/?brokerLinked=1`);
      window.location.href = redirectURI;
    } catch (e) { setErr(e.message); setBusy(''); }
  };

  const sync = async () => {
    setBusy('sync'); setErr('');
    try {
      const { portfolio } = await syncBroker();
      onSynced?.(portfolio);
      await load();
    } catch (e) { setErr(e.message); }
    finally { setBusy(''); }
  };

  if (!status) return null;

  if (!status.configured) {
    return (
      <div className="card p-3 text-[11px] text-haze">
        Auto-sync from Fidelity / Robinhood isn't set up yet. Use “paste positions” for now.
      </div>
    );
  }

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-300">
          {status.linkedAccounts.length
            ? `${status.linkedAccounts.length} brokerage account${status.linkedAccounts.length > 1 ? 's' : ''} linked`
            : 'Link your brokerage for auto-sync'}
        </p>
        <div className="flex gap-2">
          {status.linkedAccounts.length > 0 && (
            <button
              onClick={sync}
              disabled={!!busy}
              className="text-[11px] text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
            >
              {busy === 'sync' ? 'Syncing…' : 'Sync now'}
            </button>
          )}
          <button
            onClick={connect}
            disabled={!!busy}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
          >
            {busy === 'connect' ? 'Opening…' : status.linkedAccounts.length ? 'Add another' : 'Connect broker'}
          </button>
        </div>
      </div>
      {err && <p className="text-[11px] text-red-400">{err}</p>}
    </div>
  );
}
