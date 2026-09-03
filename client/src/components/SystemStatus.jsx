import { useEffect, useState } from 'react';
import { getHealth, getKeyStatus } from '../api';
import { pushState, enablePush, disablePush } from '../lib/push';

const dot = (ok) => (ok ? 'bg-emerald-400' : 'bg-red-400');

const PUSH_COPY = {
  on: 'Notifications on for this device.',
  off: 'Get pushed when the council changes its verdict on a holding or a big move hits.',
  denied: 'Notifications are blocked in your browser settings — allow them there, then reload.',
  unsupported: 'This browser can’t do push notifications. On iPhone, add Axiom to your Home Screen first.',
};

function PushToggle() {
  const [state, setState] = useState(null); // on | off | denied | unsupported
  const [busy, setBusy] = useState(false);

  useEffect(() => { pushState().then(setState); }, []);

  const toggle = async () => {
    setBusy(true);
    try {
      setState(state === 'on' ? await disablePush() : await enablePush());
    } finally {
      setBusy(false);
    }
  };

  if (state == null) return null;
  const actionable = state === 'on' || state === 'off';

  return (
    <div className="rounded-lg border hairline p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-300">Notifications</span>
        {actionable && (
          <button
            onClick={toggle}
            disabled={busy}
            className={`h-7 px-3 rounded text-[11px] font-medium disabled:opacity-50 ${
              state === 'on'
                ? 'bg-ink-800 text-haze hover:bg-ink-700'
                : 'bg-indigo-500 text-white hover:bg-indigo-400'
            }`}
          >
            {busy ? '…' : state === 'on' ? 'Turn off' : 'Turn on'}
          </button>
        )}
      </div>
      <p className="text-[11px] text-haze leading-snug">{PUSH_COPY[state]}</p>
    </div>
  );
}

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

        <PushToggle />

        {keys && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-xs">
              <span className="text-haze">API keys</span>
              <span className="font-mono text-[11px]">
                <span className={keys.live === keys.total ? 'text-emerald-400' : keys.live ? 'text-amber-400' : 'text-red-400'}>
                  Groq {keys.live}/{keys.total}
                </span>
                <span className="text-ink-600"> · </span>
                <span className={!keys.nvidiaTotal ? 'text-ink-600' : (keys.nvidiaLive === keys.nvidiaTotal ? 'text-emerald-400' : keys.nvidiaLive ? 'text-amber-400' : 'text-red-400')}>
                  NVIDIA {keys.nvidiaTotal ? `${keys.nvidiaLive}/${keys.nvidiaTotal}` : '—'}
                </span>
              </span>
            </div>
            <p className="text-[10px] text-haze">
              Synthesis model: {keys.synthProvider === 'nvidia' ? 'NVIDIA (strong)' : 'Groq (gpt-oss-120b)'}
            </p>
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
