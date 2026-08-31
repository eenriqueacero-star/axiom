import { useEffect, useState } from 'react';
import { getHealth, getKeyStatus } from '../api';

const dot = (ok) => (ok ? 'bg-emerald-400' : 'bg-red-400');

export default function SystemStatus({ open, onClose }) {
  const [health, setHealth] = useState(null);
  const [keys, setKeys] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (force = false) => {
    setBusy(true);
    setErr('');
    try {
      const [h, k] = await Promise.all([getHealth(), getKeyStatus(force)]);
      setHealth(h);
      setKeys(k);
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (open) load();
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-20 bg-black/50 flex items-start justify-center p-4" onClick={onClose}>
      <div
        className="card w-full max-w-md mt-16 p-5 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="font-mono text-xs tracking-widest text-haze">SYSTEM STATUS</h2>
          <button onClick={onClose} className="text-haze hover:text-neutral-200 text-sm">✕</button>
        </div>

        {err && <p className="text-xs text-red-400">{err}</p>}

        {health && (
          <div className="grid grid-cols-3 gap-2">
            {[
              ['Firebase', health.firebase],
              ['Push', health.push],
              ['Groq', health.groq],
            ].map(([label, ok]) => (
              <div key={label} className="flex items-center gap-2 text-xs">
                <span className={`h-2 w-2 rounded-full ${dot(ok)}`} />
                <span className="text-neutral-300">{label}</span>
              </div>
            ))}
          </div>
        )}

        {keys && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-haze">Groq keys</span>
              <span className={keys.live === keys.total ? 'text-emerald-400' : 'text-amber-400'}>
                {keys.live}/{keys.total} live
              </span>
            </div>
            <ul className="divide-y divide-ink-800 rounded-lg border hairline overflow-hidden">
              {keys.keys.map((k) => (
                <li key={k.index} className="flex items-center justify-between px-3 py-2 text-xs">
                  <div className="flex items-center gap-2">
                    <span className={`h-2 w-2 rounded-full ${dot(k.ok)}`} />
                    <span className="font-mono text-neutral-300">{k.name}</span>
                  </div>
                  <span className="text-haze">
                    {k.ok ? `${k.ms}ms` : k.error || `HTTP ${k.status}`}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        <button
          onClick={() => load(true)}
          disabled={busy}
          className="w-full h-9 rounded-lg bg-ink-800 text-xs text-neutral-300 hover:bg-ink-700 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Re-check now'}
        </button>
      </div>
    </div>
  );
}
