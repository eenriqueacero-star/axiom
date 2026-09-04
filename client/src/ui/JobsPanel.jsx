import { useEffect, useState } from 'react';
import { getJobs, patchJob, runJob } from '../api';
import Icon from './Icon';

function rel(ts, { future = false } = {}) {
  if (!ts) return '—';
  const diff = future ? ts - Date.now() : Date.now() - ts;
  const s = Math.round(diff / 1000);
  if (s < 0) return future ? 'now' : `${-s}s`;
  if (s < 60) return future ? `in ${s}s` : `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return future ? `in ${m}m` : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return future ? `in ${h}h` : `${h}h ago`;
  const d = Math.floor(h / 24);
  return future ? `in ${d}d` : `${d}d ago`;
}

function everyText(ms) {
  if (!ms) return '';
  const min = Math.round(ms / 60000);
  if (min < 60) return `every ${min}m`;
  const h = min / 60;
  return `every ${Number.isInteger(h) ? h : h.toFixed(1)}h`;
}

const CHIP = {
  ok: 'text-muted border-line',
  pending: 'text-faint border-line',
  overdue: 'text-warn border-warn/40',
  failing: 'text-crit border-crit/40',
};

function Editor({ job, onSaved }) {
  const startMin = Math.max(1, Math.round((job.everyMs || 3600000) / 60000));
  const [unit, setUnit] = useState(startMin % 60 === 0 && startMin >= 60 ? 'hour' : 'min');
  const [amount, setAmount] = useState(unit === 'hour' ? startMin / 60 : startMin);
  const [weekdaysOnly, setWeekdaysOnly] = useState(!!job.weekdaysOnly);
  const win = Array.isArray(job.hours) ? job.hours : [];
  const [h0, setH0] = useState(win[0] ?? '');
  const [h1, setH1] = useState(win[1] ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (reset) => {
    setBusy(true);
    try {
      const patch = reset
        ? { everyMs: null, hours: null, weekdaysOnly: null }
        : {
            everyMs: Math.max(60000, Number(amount) * (unit === 'hour' ? 3600000 : 60000)),
            weekdaysOnly,
            hours: h0 === '' || h1 === '' ? null : [Number(h0), Number(h1)],
          };
      const updated = await patchJob(job.name, patch);
      onSaved(updated);
    } catch (e) {
      onSaved(null, e.message);
    }
    setBusy(false);
  };

  return (
    <div className="mt-3 space-y-2.5 border-t border-line pt-3">
      <div className="flex items-center gap-2">
        <span className="label">frequency</span>
        <input type="number" min="1" value={amount} onChange={(e) => setAmount(e.target.value)}
          className="mono w-16 rounded-md border border-line bg-base px-2 py-1 text-[12px] text-text" />
        <select value={unit} onChange={(e) => setUnit(e.target.value)}
          className="mono rounded-md border border-line bg-base px-2 py-1 text-[12px] text-text">
          <option value="min">min</option>
          <option value="hour">hour</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-[11px] text-muted">
        <input type="checkbox" checked={weekdaysOnly} onChange={(e) => setWeekdaysOnly(e.target.checked)} />
        weekdays only
      </label>
      <div className="flex items-center gap-2">
        <span className="label">hours ET</span>
        <input type="number" min="0" max="23" placeholder="—" value={h0} onChange={(e) => setH0(e.target.value)}
          className="mono w-14 rounded-md border border-line bg-base px-2 py-1 text-[12px] text-text" />
        <span className="text-faint">to</span>
        <input type="number" min="0" max="23" placeholder="—" value={h1} onChange={(e) => setH1(e.target.value)}
          className="mono w-14 rounded-md border border-line bg-base px-2 py-1 text-[12px] text-text" />
      </div>
      <div className="flex items-center gap-2">
        <button onClick={() => save(false)} disabled={busy} className="btn-accent h-7 px-3 text-[11px] disabled:opacity-50">
          {busy ? 'saving…' : 'save'}
        </button>
        <button onClick={() => save(true)} disabled={busy} className="btn-ghost press h-7 px-3 text-[11px]">
          reset to default
        </button>
      </div>
    </div>
  );
}

function JobRow({ job, onChange, onAskBoss }) {
  const [editing, setEditing] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState('');
  const status = job.status || (job.enabled === false ? 'pending' : 'ok');

  const toggle = async () => {
    const next = !(job.enabled !== false);
    onChange({ ...job, enabled: next }); // optimistic
    try {
      const updated = await patchJob(job.name, { enabled: next });
      onChange(updated);
    } catch {
      onChange(job); // revert
    }
  };

  const doRun = async () => {
    setRunning(true); setRunMsg('');
    try {
      const r = await runJob(job.name);
      setRunMsg(r?.ok ? `ok · ${r.durationMs ?? '?'}ms` : `failed: ${r?.error || 'error'}`);
    } catch (e) {
      setRunMsg(`failed: ${e.message}`);
    }
    setRunning(false);
    setTimeout(() => setRunMsg(''), 6000);
  };

  return (
    <div className="panel rounded-lg p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-[12.5px] text-text">{job.label || job.name}</span>
            <span className={`mono text-2xs rounded border px-1.5 py-0.5 uppercase ${CHIP[status] || CHIP.ok}`}>
              {status}
            </span>
            {job.gatedOut && <span className="mono text-2xs text-faint">gated</span>}
            {job.overridden && <span className="mono text-2xs text-accent">override</span>}
          </div>
          <div className="mono text-2xs text-faint mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
            <span>{everyText(job.everyMs)}</span>
            {job.window && <span>{job.window}</span>}
            <span>ran {rel(job.lastRunAt || job.lastOkAt)}</span>
            <span>due {rel(job.nextDueAt, { future: true })}</span>
            <span>{job.runs ?? 0} runs · {job.fails ?? 0} fails</span>
          </div>
          {status === 'failing' && job.error && (
            <p className="mono text-2xs text-crit mt-1.5 break-words leading-snug">{job.error}</p>
          )}
          {runMsg && <p className="mono text-2xs mt-1.5 text-muted">{runMsg}</p>}
        </div>
        <label className="flex shrink-0 cursor-pointer items-center" title={job.enabled !== false ? 'enabled' : 'disabled'}>
          <input type="checkbox" checked={job.enabled !== false} onChange={toggle} className="accent-[var(--accent)]" />
        </label>
      </div>

      <div className="mt-2.5 flex items-center gap-2">
        <button onClick={doRun} disabled={running} className="btn-ghost press h-7 px-2.5 text-[11px] disabled:opacity-50">
          {running ? 'running…' : 'run now'}
        </button>
        <button onClick={() => setEditing((v) => !v)} className="btn-ghost press h-7 px-2.5 text-[11px]">
          {editing ? 'close' : 'edit'}
        </button>
        {onAskBoss && (
          <button onClick={() => onAskBoss(job.name)} title="ask the boss about this job"
            className="press ml-auto flex h-7 w-7 items-center justify-center rounded-md text-muted hover:text-text">
            <Icon name="chat" size={13} />
          </button>
        )}
      </div>

      {editing && (
        <Editor job={job} onSaved={(u, err) => {
          if (u) { onChange(u); setEditing(false); }
          else if (err) setRunMsg(`save failed: ${err}`);
        }} />
      )}
    </div>
  );
}

export default function JobsPanel({ onAskBoss }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');

  const load = () => getJobs().then(setData).catch((e) => setErr(e.message));

  useEffect(() => {
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);

  const patchLocal = (job) =>
    setData((d) => d && { ...d, jobs: d.jobs.map((j) => (j.name === job.name ? { ...j, ...job } : j)) });

  const jobs = data?.jobs || [];
  const failing = data?.failing?.length || jobs.filter((j) => j.status === 'failing').length;
  const overdue = data?.overdue?.length || jobs.filter((j) => j.status === 'overdue').length;
  const summary = failing || overdue
    ? [overdue && `${overdue} overdue`, failing && `${failing} failing`].filter(Boolean).join(', ')
    : `${jobs.length} jobs · all running`;

  return (
    <div className="space-y-3">
      <div>
        <h3 className="label !tracking-[0.16em]">The desk's schedule</h3>
        <p className={`mono text-2xs mt-1 ${failing ? 'text-crit' : overdue ? 'text-warn' : 'text-muted'}`}>
          {err ? `couldn't load: ${err}` : summary}
        </p>
      </div>
      {jobs.map((job) => (
        <JobRow key={job.name} job={job} onChange={patchLocal} onAskBoss={onAskBoss} />
      ))}
      {!data && !err && <p className="mono text-2xs text-faint">loading…</p>}
    </div>
  );
}
