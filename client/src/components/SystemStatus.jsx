import { useEffect, useState } from 'react';
import { getHealth, getKeyStatus, getJobs, sendTestPush, getNotifyPrefs, setNotifyPrefs } from '../api';
import { pushState, enablePush, disablePush } from '../lib/push';
import { navlogRead, navlogClear, swReport } from '../lib/navdebug';

function NavDebug() {
  const [rep, setRep] = useState(null);
  const [log, setLog] = useState([]);
  const load = () => { swReport().then(setRep); setLog(navlogRead()); };
  useEffect(() => { load(); }, []);

  return (
    <div className="rounded-lg border hairline p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-300">Notification routing</span>
        <div className="flex gap-2">
          <button onClick={load} className="text-[11px] text-indigo-400 hover:text-indigo-300">refresh</button>
          <button onClick={() => { navlogClear(); setLog([]); }} className="text-[11px] text-haze hover:text-neutral-300">clear</button>
        </div>
      </div>
      {rep && (
        <div className="text-[10px] font-mono text-haze space-y-0.5">
          <div>standalone: {String(rep.standalone)} · sw: {rep.supported ? 'yes' : 'no'}</div>
          <div>controller: {rep.controller ? rep.controller.split('/').pop() : 'none'}</div>
          <div>active: {rep.active ? rep.active.split('/').pop() : 'none'} · waiting: {String(rep.waiting)}</div>
          <div>pending nav: {rep.pendingNav || 'none'}{rep.cacheError ? ` (err: ${rep.cacheError})` : ''}</div>
        </div>
      )}
      {((rep?.swLog?.length || 0) + log.length) > 0 && (
        <ul className="text-[10px] font-mono text-haze max-h-52 overflow-y-auto space-y-0.5 border-t border-ink-800 pt-1">
          {(rep?.swLog || []).map((l, i) => <li key={`sw${i}`} className="text-amber-300/70">{l}</li>)}
          {log.map((l, i) => <li key={i}>{l}</li>)}
        </ul>
      )}
    </div>
  );
}

const NOTIF_KINDS = [
  ['news', 'News'], ['filing', 'Filings'], ['insider', 'Insider trades'],
  ['congress', 'Congress'], ['move', 'Big moves'], ['rating', 'Rating changes'],
  ['scout', 'Scout ideas'], ['desk', 'The desk'], ['opportunity', 'Opportunities'],
];
const NEXT_MODE = { push: 'digest', digest: 'off', off: 'push' };
const MODE_STYLE = {
  push: 'bg-emerald-500/15 text-emerald-300',
  digest: 'bg-amber-500/15 text-amber-300',
  off: 'bg-ink-800 text-ink-500',
};

function NotifPrefs() {
  const [prefs, setPrefs] = useState(null);
  useEffect(() => { getNotifyPrefs().then(setPrefs).catch(() => {}); }, []);
  if (!prefs) return null;

  const cycle = (kind) => {
    const next = { ...prefs, kinds: { ...prefs.kinds, [kind]: NEXT_MODE[prefs.kinds[kind] || 'push'] } };
    setPrefs(next);
    setNotifyPrefs({ kinds: { [kind]: next.kinds[kind] } }).catch(() => {});
  };
  const setQuiet = (field, val) => {
    const v = Math.max(0, Math.min(23, Number(val) || 0));
    const next = { ...prefs, [field]: v };
    setPrefs(next);
    setNotifyPrefs({ [field]: v }).catch(() => {});
  };

  return (
    <div className="rounded-lg border hairline p-3 space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-300">What gets pushed</span>
        <span className="text-[10px] text-haze">push · digest · off</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5">
        {NOTIF_KINDS.map(([k, label]) => (
          <button key={k} onClick={() => cycle(k)}
            className="flex items-center justify-between px-2 py-1 rounded text-[11px] bg-ink-900/50 hover:bg-ink-850">
            <span className="text-neutral-300 truncate">{label}</span>
            <span className={`ml-1 shrink-0 px-1.5 py-0.5 rounded text-[9px] font-mono ${MODE_STYLE[prefs.kinds[k] || 'push']}`}>
              {prefs.kinds[k] || 'push'}
            </span>
          </button>
        ))}
      </div>
      <div className="flex items-center gap-2 text-[11px] text-haze">
        <span>Quiet hours (ET)</span>
        <input type="number" min="0" max="23" value={prefs.quietStart}
          onChange={(e) => setQuiet('quietStart', e.target.value)}
          className="w-11 bg-ink-900 rounded px-1 py-0.5 text-neutral-200 text-center" />
        <span>to</span>
        <input type="number" min="0" max="23" value={prefs.quietEnd}
          onChange={(e) => setQuiet('quietEnd', e.target.value)}
          className="w-11 bg-ink-900 rounded px-1 py-0.5 text-neutral-200 text-center" />
      </div>
      <p className="text-[10px] text-haze leading-snug">
        Critical alerts (an EXIT on a held name, a thesis-level filing) always push. “digest” items are rolled into a morning + close summary.
      </p>
    </div>
  );
}

const dot = (ok) => (ok ? 'bg-emerald-400' : 'bg-red-400');

const ago = (ts) => {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
};

const everyLabel = (ms) => {
  const h = ms / 3_600_000;
  if (h >= 24) return `every ~${Math.round(h / 24)}d`;
  if (h >= 1) return `every ${Math.round(h)}h`;
  return `every ${Math.round(ms / 60_000)}m`;
};

const JOB_STATUS = {
  ok: { c: 'bg-emerald-400', t: 'text-emerald-400' },
  failing: { c: 'bg-red-400', t: 'text-red-400' },
  overdue: { c: 'bg-amber-400', t: 'text-amber-400' },
  pending: { c: 'bg-ink-600', t: 'text-haze' },
};

function JobsPanel({ data }) {
  if (!data) return null;
  const summary = data.healthy
    ? 'All jobs running in order.'
    : [
        data.failing.length && `${data.failing.length} failing`,
        data.overdue.length && `${data.overdue.length} overdue`,
      ].filter(Boolean).join(' · ');

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-haze">Scheduled jobs</span>
        <span className={`font-mono text-[11px] ${data.healthy ? 'text-emerald-400' : 'text-amber-400'}`}>
          {summary}
        </span>
      </div>
      <ul className="divide-y divide-ink-800 rounded-lg border hairline overflow-hidden">
        {data.jobs.map((j) => {
          const s = JOB_STATUS[j.status] || JOB_STATUS.pending;
          return (
            <li key={j.name} className="px-3 py-2 text-xs">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${s.c}`} />
                  <span className="text-neutral-300 truncate">{j.label}</span>
                </div>
                <span className={`font-mono text-[10px] shrink-0 ${s.t}`}>
                  {j.status}{j.consecutiveFailures > 1 ? ` ×${j.consecutiveFailures}` : ''}
                </span>
              </div>
              <div className="mt-0.5 pl-4 flex items-center justify-between text-[10px] text-haze">
                <span>{everyLabel(j.everyMs)}{j.window !== 'always' ? ` · ${j.window}` : ''}{j.gatedOut ? ' · idle now' : ''}</span>
                <span>ran {ago(j.lastRunAt)}{j.ok === false && j.lastOkAt ? ` · ok ${ago(j.lastOkAt)}` : ''}</span>
              </div>
              {j.error && (
                <p className="mt-1 pl-4 text-[10px] text-red-400 break-words leading-snug">{j.error}</p>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const PUSH_COPY = {
  on: 'Notifications on for this device.',
  off: 'Get pushed when the council changes its verdict on a holding or a big move hits.',
  denied: 'Notifications are blocked in your browser settings — allow them there, then reload.',
  unsupported: 'This browser can’t do push notifications. On iPhone, add Axiom to your Home Screen first.',
};

function PushToggle() {
  const [state, setState] = useState(null); // on | off | denied | unsupported
  const [busy, setBusy] = useState(false);
  const [testMsg, setTestMsg] = useState('');

  useEffect(() => { pushState().then(setState); }, []);

  const test = async () => {
    setTestMsg('sending…');
    try {
      const { sent } = await sendTestPush();
      setTestMsg(sent > 0 ? `sent to ${sent} device${sent > 1 ? 's' : ''} — check your notifications` : 'no devices registered — turn it off and on again');
    } catch (e) {
      setTestMsg(`failed: ${e.message}`);
    }
  };

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
      {state === 'on' && (
        <div className="flex items-center gap-2">
          <button onClick={test} className="text-[11px] text-indigo-400 hover:text-indigo-300">Send a test</button>
          {testMsg && <span className="text-[10px] text-haze">{testMsg}</span>}
        </div>
      )}
    </div>
  );
}

export default function SystemStatus({ open, onClose }) {
  const [health, setHealth] = useState(null);
  const [keys, setKeys] = useState(null);
  const [jobs, setJobs] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const load = async (force = false) => {
    setBusy(true);
    setErr('');
    try {
      const [h, k, j] = await Promise.all([getHealth(), getKeyStatus(force), getJobs().catch(() => null)]);
      setHealth(h);
      setKeys(k);
      setJobs(j);
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
    <div className="fixed inset-0 z-20 bg-black/50 flex items-start justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div
        className="card w-full max-w-md my-8 p-5 space-y-4 max-h-[85vh] overflow-y-auto"
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

        <NotifPrefs />

        <NavDebug />

        <JobsPanel data={jobs} />

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
