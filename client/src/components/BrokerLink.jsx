import { useEffect, useState } from 'react';
import { getBrokerStatus, syncBroker } from '../api';

export default function BrokerLink({ onSynced }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const load = () => getBrokerStatus().then(setStatus).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const sync = async () => {
    setBusy(true);
    setErr('');
    try {
      const { portfolio, synced } = await syncBroker();
      onSynced?.(portfolio);
      await load();
      if (!synced) setErr('No linked accounts found — connect a brokerage in SnapTrade first.');
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;

  if (!status.configured) {
    return (
      <div className="card p-3 text-[11px] text-haze">
        Broker auto-sync isn't set up yet. Use “paste positions” below.
      </div>
    );
  }

  const linked = status.linkedAccounts.length;

  return (
    <div className="card p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs text-neutral-300">
          {linked
            ? `${linked} brokerage account${linked > 1 ? 's' : ''} linked via SnapTrade`
            : status.connections
              ? `${status.connections} brokerage connection${status.connections > 1 ? 's' : ''} — sync to import`
              : 'Connect your brokerages in SnapTrade to auto-sync'}
        </p>
        <div className="flex gap-3">
          <a
            href="https://dashboard.snaptrade.com/home"
            target="_blank"
            rel="noreferrer noopener"
            className="text-[11px] text-haze hover:text-neutral-300"
          >
            Manage in SnapTrade ↗
          </a>
          <button
            onClick={sync}
            disabled={busy}
            className="text-[11px] text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
          >
            {busy ? 'Syncing…' : 'Sync now'}
          </button>
        </div>
      </div>
      {err && <p className="text-[11px] text-red-400">{err}</p>}
    </div>
  );
}
