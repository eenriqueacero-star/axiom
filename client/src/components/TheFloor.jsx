import { useEffect, useState } from 'react';
import { getFloor, getDca } from '../api';
import { stanceStyle, verdictStyle } from './stance';
import { AgentPanel, AgentChat, rel } from './floor/shared';

function DcaCard() {
  const [d, setD] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => { getDca().then(setD).catch((e) => setErr(e.message)); }, []);
  if (err || !d) return null;

  return (
    <div className="card p-4">
      <p className="text-[11px] uppercase tracking-widest text-haze mb-2">This cycle's contribution</p>
      {!d.ready ? (
        <p className="text-xs text-haze">{d.note}</p>
      ) : d.pick ? (
        <>
          <p className="text-sm text-neutral-100">
            → <span className="font-mono text-emerald-400">{d.pick.ticker}</span>
            <span className="text-haze"> · {d.pick.sector}</span>
          </p>
          <p className="text-xs text-neutral-400 mt-1">{d.pick.reason}</p>
        </>
      ) : (
        <>
          <p className="text-sm text-neutral-100">→ <span className="font-mono text-amber-400">{d.buffer.etf}</span> (buffer)</p>
          <p className="text-xs text-neutral-400 mt-1">{d.buffer.reason}</p>
        </>
      )}
      {d.ready && d.ranked?.length > 0 && (
        <div className="mt-3 space-y-1">
          {d.ranked.slice(0, 5).map((r) => (
            <div key={r.ticker} className="flex items-center gap-2 text-[11px]">
              <span className="font-mono w-14 text-neutral-300">{r.ticker}</span>
              <span className={r.entryOk === true ? 'text-emerald-400' : r.entryOk === false ? 'text-red-400' : 'text-ink-600'}>
                {r.entryOk === true ? '✓' : r.entryOk === false ? '✗' : '–'}
              </span>
              <span className="text-haze flex-1 truncate">{r.entryWhy}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Room({ agent, data, onAnalyze }) {
  const [open, setOpen] = useState(false);
  const last = data?.recent?.[0];
  const s = last ? stanceStyle(last.stance) : null;

  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full p-4 text-left">
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-base">{agent.emoji}</span>
            <span className="font-mono text-xs tracking-wider" style={{ color: agent.color }}>{agent.name}</span>
          </div>
          {s && (
            <span className="text-[10px] font-semibold px-2 py-0.5 rounded" style={{ color: s.fg, background: s.bg }}>
              {s.label}
            </span>
          )}
        </div>
        <p className="text-[11px] uppercase tracking-wide text-haze">{agent.role}</p>
        <p className="text-[11px] text-ink-500 mt-1">
          {data?.calls || 0} calls
          {last ? ` · last: ${last.ticker} ${rel(last.ts)}` : ''}
        </p>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-3 border-t hairline pt-3">
          <AgentPanel agent={agent} data={data} onAnalyze={onAnalyze} />
          <AgentChat agent={agent} />
        </div>
      )}
    </div>
  );
}

export default function TheFloor({ onAnalyze }) {
  const [floor, setFloor] = useState(null);
  const [err, setErr] = useState('');

  useEffect(() => { getFloor().then(setFloor).catch((e) => setErr(e.message)); }, []);

  if (err) return <p className="text-xs text-red-400">{err}</p>;
  if (!floor) return <p className="text-xs text-haze animate-pulse">Loading the floor…</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-sm text-neutral-200">The Floor</h1>
        <p className="text-[11px] text-haze">
          Six analysts. Each answers a fixed set of yes/no checks; the verdict is computed from them against the rulebook.
          {floor.scored > 0 ? ` ${floor.scored} past calls scored.` : ' No calls scored yet — track records fill in after ~1 week.'}
        </p>
      </div>

      <DcaCard />

      <div className="grid gap-3 sm:grid-cols-2">
        {floor.agents.map((a) => (
          <Room key={a.id} agent={a} data={floor.perAgent[a.id]} onAnalyze={onAnalyze} />
        ))}
      </div>

      <div className="card p-4">
        <p className="text-[11px] uppercase tracking-widest text-haze mb-2">Scheduled work</p>
        <ul className="space-y-2">
          {floor.schedule.map((j) => (
            <li key={j.job} className="text-xs">
              <span className="text-neutral-200">{j.job}</span>
              <span className="text-ink-500"> · {j.cadence}</span>
              <p className="text-[11px] text-haze">{j.does}</p>
            </li>
          ))}
        </ul>
      </div>

      {floor.recentRuns.length > 0 && (
        <div>
          <p className="text-[11px] uppercase tracking-widest text-haze mb-2">Council activity</p>
          <ul className="divide-y divide-ink-800 card overflow-hidden">
            {floor.recentRuns.map((r) => {
              const v = verdictStyle(r.verdict);
              return (
                <li key={r.id}>
                  <button onClick={() => onAnalyze(r.ticker)} className="w-full flex items-center justify-between px-4 py-3 hover:bg-ink-850 text-left">
                    <div className="flex items-center gap-3 min-w-0">
                      <span className="font-mono text-sm text-neutral-200">{r.ticker}</span>
                      <span className="text-[11px] text-haze truncate">{r.headline}</span>
                    </div>
                    <span className="text-xs font-semibold shrink-0 ml-2" style={{ color: v.fg }}>
                      {r.verdict} · {r.conviction}/10
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}
