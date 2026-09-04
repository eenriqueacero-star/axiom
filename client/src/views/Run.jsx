import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runCouncil, startExecution } from '../api';
import Icon, { AGENT_IDS, AGENT_META } from '../ui/Icon';

/* ---- helpers ---------------------------------------------------------- */

const VERDICT_ICON = { ADD: 'add', HOLD: 'hold', TRIM: 'trim', EXIT: 'exit' };
const VERDICT_COLOR = {
  ADD: 'var(--good)', HOLD: 'var(--muted)', TRIM: 'var(--warn)', EXIT: 'var(--crit)',
};
const STANCE_COLOR = {
  PASS: 'var(--good)', FAIL: 'var(--crit)', BEARISH: 'var(--crit)',
  CAUTION: 'var(--warn)', NEUTRAL: 'var(--muted)',
};

const FLAG_LABEL = {
  broken: 'THESIS BROKEN',
  downtrend: 'DOWNTREND',
  downtrendExit: 'DOWNTREND EXIT',
  atCap: 'AT CAP',
  entryClear: 'ENTRY NOT CLEAR', // shown only when entryClear === false
  concentrationTrim: 'CONCENTRATION',
};

function humanize(key) {
  return String(key)
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^./, (c) => c.toUpperCase());
}

const money = (n) =>
  n == null ? '—' : `$${Math.round(n).toLocaleString()}`;
const pct = (n) =>
  n == null ? '' : `${n >= 0 ? '+' : '−'}${Math.abs(n).toFixed(1)}%`;
// server sends fractions (0.12) for holdings ratios, whole percents for changePct
const asPct = (n) => (n == null ? null : Math.abs(n) <= 1 ? n * 100 : n);

/* ---- the six analyst marks ------------------------------------------- */

function AgentMark({ id, size = 44, working, done, dim }) {
  const meta = AGENT_META[id];
  return (
    <span
      className="relative grid place-items-center rounded-full border"
      style={{
        width: size, height: size,
        borderColor: working || done ? meta.color : 'var(--line-2)',
        color: dim ? 'var(--faint)' : meta.color,
        opacity: dim ? 0.5 : 1,
        boxShadow: done ? `0 0 14px -4px ${meta.color}` : 'none',
        transition: 'all 0.4s var(--ease-spring)',
      }}
    >
      <Icon name={id} size={Math.round(size * 0.42)} />
      {working && (
        <span
          className="absolute inset-0 rounded-full animate-[apulse_2.4s_ease-out_infinite]"
          style={{ border: `1px solid ${meta.color}` }}
        />
      )}
    </span>
  );
}

function WorkingGrid({ revealed }) {
  return (
    <div className="px-6 py-8">
      <div className="label mb-4 flex items-center gap-1.5">
        <i className="h-1 w-1 rounded-full bg-accent" style={{ background: 'var(--accent)' }} />
        The council convenes
      </div>
      <div className="flex flex-wrap gap-5">
        {AGENT_IDS.map((id, i) => (
          <div key={id} className="flex flex-col items-center gap-2" style={{ width: 72 }}>
            <AgentMark id={id} working={!revealed.includes(id)} done={revealed.includes(id)} />
            <span className="mono text-[9px] tracking-[0.1em] text-faint">{AGENT_META[id].name}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ---- verdict banner ------------------------------------------------- */

function FlagChips({ computed }) {
  if (!computed) return null;
  const flags = [];
  if (computed.broken) flags.push('broken');
  if (computed.downtrend) flags.push('downtrend');
  if (computed.downtrendExit) flags.push('downtrendExit');
  if (computed.atCap) flags.push('atCap');
  if (computed.entryClear === false) flags.push('entryClear');
  if (computed.concentrationTrim) flags.push('concentrationTrim');
  if (!flags.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-1.5">
      {flags.map((f) => (
        <span
          key={f}
          className="mono text-[9px] tracking-[0.1em] rounded-sm px-1.5 py-0.5"
          style={{ color: 'var(--crit)', border: '1px solid var(--crit)' }}
        >
          {FLAG_LABEL[f] || f.toUpperCase()}
        </span>
      ))}
    </div>
  );
}

function VerdictBanner({ r }) {
  const color = VERDICT_COLOR[r.verdict] || 'var(--muted)';
  const isDecision = r.mandate === 'decision';
  const econ = r.holdings?.econ;
  return (
    <div className="rise-in">
      <div className="flex items-start gap-4">
        <span
          className="grid h-14 w-14 shrink-0 place-items-center rounded-full border"
          style={{ borderColor: color, color, boxShadow: `0 0 20px -6px ${color}` }}
        >
          <Icon name={VERDICT_ICON[r.verdict] || 'hold'} size={26} />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-wide text-2xl font-bold tracking-tight" style={{ color: 'var(--lit)' }}>
              {r.verdict}
            </span>
            <span className="mono text-sm text-text tabular-nums">{r.conviction}/10</span>
            {r.tier && (
              <span className="mono text-[10px] tracking-[0.14em] text-muted">{r.tier}</span>
            )}
          </div>
          <div className="mt-0.5 mono text-[10px] tracking-[0.08em] text-faint">
            {isDecision ? 'a decision the rulebook forces' : 'a suggestion'}
          </div>
        </div>
      </div>

      {r.headline && (
        <p className="mt-4 text-[15px] font-semibold leading-snug text-text">{r.headline}</p>
      )}
      {r.rationale && (
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{r.rationale}</p>
      )}

      <FlagChips computed={r.computed} />

      {r.impact && (
        <div className="mt-4 rounded-lg border border-line-2 p-4">
          <div className="label mb-1.5">What it means for the book</div>
          <p className="text-[13px] leading-relaxed text-text">{r.impact}</p>
        </div>
      )}

      {econ && econ.shares != null && (
        <p className="mt-3 mono text-[11px] leading-relaxed text-muted">
          We hold {econ.shares} sh at {money(econ.avgCost)} avg, worth {money(econ.value)}
          {r.holdings?.positionPct != null && ` (${Math.round(asPct(r.holdings.positionPct))}% of the book)`}
          {econ.unrealPct != null && (
            <span style={{ color: econ.unrealPct >= 0 ? 'var(--good)' : 'var(--crit)' }}>
              {' '}· {pct(asPct(econ.unrealPct))}
            </span>
          )}
        </p>
      )}
    </div>
  );
}

/* ---- agent card --------------------------------------------------- */

function AgentCard({ id, agent, delay }) {
  const meta = AGENT_META[id];
  const stance = agent?.stance;
  const stanceColor = STANCE_COLOR[stance] || 'var(--muted)';
  const checks = agent?.checks && typeof agent.checks === 'object' ? Object.entries(agent.checks) : [];
  return (
    <div
      className="rise-in rounded-lg border border-line p-4"
      style={{ borderLeft: `2px solid ${meta.color}`, animationDelay: `${delay}ms` }}
    >
      <div className="flex items-center gap-2.5">
        <span style={{ color: meta.color }}><Icon name={id} size={16} /></span>
        <span className="mono text-[11px] tracking-[0.1em] text-text">{meta.name}</span>
        <span className="ml-auto mono text-[10px] tracking-[0.1em]" style={{ color: stanceColor }}>
          {stance || '—'}
        </span>
      </div>
      {(agent?.headline || agent?.note) && (
        <p className="mt-2 text-[12px] leading-relaxed text-muted">
          {agent?.headline || agent?.note}
        </p>
      )}
      {agent?.headline && agent?.note && agent.note !== agent.headline && (
        <p className="mt-1 text-[11px] leading-relaxed text-faint">{agent.note}</p>
      )}
      {checks.length > 0 && (
        <ul className="mt-3 flex flex-col gap-1">
          {checks.map(([k, v]) => (
            <li key={k} className="flex items-center gap-2 text-[11px] text-muted">
              {v === null ? (
                <span className="text-faint"><Icon name="hold" size={12} /></span>
              ) : (
                <span style={{ color: v ? 'var(--good)' : 'var(--crit)' }}>
                  <Icon name={v ? 'check' : 'cross'} size={12} />
                </span>
              )}
              <span>{humanize(k)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgentCards({ result, className = '' }) {
  const byId = useMemo(() => {
    const a = result.agents;
    if (!a) return {};
    if (Array.isArray(a)) {
      const m = {};
      a.forEach((x) => { if (x?.id) m[x.id] = x; });
      return m;
    }
    return a; // server returns an object keyed by agent id
  }, [result]);
  return (
    <div className={className}>
      {AGENT_IDS.map((id, i) => (
        <AgentCard key={id} id={id} agent={byId[id]} delay={i * 60} />
      ))}
    </div>
  );
}

/* ---- news strip -------------------------------------------------- */

function NewsStrip({ news, catalyst, nextEarnings }) {
  const items = Array.isArray(news) ? news : [];
  if (!items.length && !catalyst && !nextEarnings) return null;
  return (
    <div className="rise-in">
      <div className="label mb-2">On the wire</div>
      {catalyst && (
        <div
          className="mb-2 rounded-md px-3 py-2 text-[12px] leading-snug text-text"
          style={{ border: '1px solid var(--nova)', color: 'var(--nova)' }}
        >
          <span className="mono text-[9px] tracking-[0.14em]">CATALYST</span>
          <span className="ml-2 text-text">{catalyst}</span>
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        {items.map((n, i) => {
          const row = (
            <>
              <Icon name="news" size={12} className="mt-0.5 shrink-0 text-faint" />
              <span className="min-w-0">
                <span className="text-[12px] leading-snug text-text">{n.headline}</span>
                <span className="ml-1.5 mono text-[9px] tracking-[0.08em] text-faint">
                  {[n.source, n.date].filter(Boolean).join(' · ')}
                </span>
              </span>
            </>
          );
          return n.url ? (
            <a key={i} href={n.url} target="_blank" rel="noreferrer"
              className="flex gap-2 text-left hover:opacity-80">{row}</a>
          ) : (
            <div key={i} className="flex gap-2">{row}</div>
          );
        })}
      </div>
      {nextEarnings && (
        <p className="mt-2 mono text-[10px] tracking-[0.08em] text-faint">
          Next earnings {nextEarnings}
        </p>
      )}
    </div>
  );
}

/* ---- ticker input ---------------------------------------------- */

function TickerBar({ value, onChange, onSubmit, busy, bar }) {
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(); }}
      className={bar
        ? 'flex items-center gap-3 border-b border-line px-8 py-4'
        : 'flex items-center gap-2 px-6 pt-6'}
    >
      <input
        value={value}
        onChange={(e) => onChange(e.target.value.toUpperCase().replace(/[^A-Z.]/g, '').slice(0, 6))}
        placeholder="TICKER"
        inputMode="text"
        autoCapitalize="characters"
        spellCheck={false}
        disabled={busy}
        className="mono flex-1 rounded-lg border border-line-2 bg-panel px-4 py-3 text-lg tracking-[0.12em] text-text placeholder:text-faint focus:border-faint focus:outline-none disabled:opacity-50"
        style={bar ? { maxWidth: 220 } : undefined}
      />
      <button
        type="submit"
        disabled={busy || !value}
        className="btn-accent shrink-0 px-5 py-3 disabled:opacity-40"
      >
        {busy ? 'CONVENING…' : 'CONVENE'}
      </button>
    </form>
  );
}

/* ---- empty state --------------------------------------------- */

function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-12 text-center">
      <div className="flex gap-3">
        {AGENT_IDS.map((id) => (
          <AgentMark key={id} id={id} size={34} dim />
        ))}
      </div>
      <p className="mt-5 text-[12px] text-muted">Name a ticker and the council convenes.</p>
    </div>
  );
}

/* ---- main --------------------------------------------------- */

export default function Run({ desktop, initialTicker }) {
  const [ticker, setTicker] = useState((initialTicker || '').toUpperCase());
  const [phase, setPhase] = useState('idle'); // idle | working | done | error
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  const [revealed, setRevealed] = useState([]);
  const [toast, setToast] = useState('');
  const [proceedErr, setProceedErr] = useState('');
  const [proceeding, setProceeding] = useState(false);
  const timers = useRef([]);
  const ranInitial = useRef(false);

  const clearTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };

  const run = useCallback(async (sym) => {
    const t = (sym || '').trim().toUpperCase();
    if (!t) return;
    clearTimers();
    setPhase('working');
    setResult(null);
    setError('');
    setProceedErr('');
    setRevealed([]);
    // staggered reveal for feel
    AGENT_IDS.forEach((id, i) => {
      timers.current.push(setTimeout(() => {
        setRevealed((r) => (r.includes(id) ? r : [...r, id]));
      }, 1400 + i * 1500));
    });
    try {
      const res = await runCouncil(t, false);
      clearTimers();
      setRevealed(AGENT_IDS);
      setResult(res);
      setPhase('done');
    } catch (e) {
      clearTimers();
      setError(e?.message || 'Council unreachable');
      setPhase('error');
    }
  }, []);

  useEffect(() => {
    if (ranInitial.current) return;
    ranInitial.current = true;
    if (initialTicker) run(initialTicker);
  }, [initialTicker, run]);

  useEffect(() => () => clearTimers(), []);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(''), 3200);
    return () => clearTimeout(id);
  }, [toast]);

  const proceed = async () => {
    if (!result?.ticker) return;
    setProceeding(true);
    setProceedErr('');
    try {
      await startExecution(result.ticker);
      setToast('Opened with the boss');
    } catch (e) {
      setProceedErr(e?.message || 'Could not open an execution thread');
    } finally {
      setProceeding(false);
    }
  };

  const busy = phase === 'working';

  const proceedBtn = result && result.mandate && (
    <div className="mt-5">
      <button onClick={proceed} disabled={proceeding} className="btn-accent px-5 py-2.5 disabled:opacity-40">
        {proceeding ? 'OPENING…' : 'Proceed →'}
      </button>
      {proceedErr && <p className="mt-2 mono text-[11px] text-crit">{proceedErr}</p>}
    </div>
  );

  const priceLine = result && (result.price != null || result.changePct != null) && (
    <div className="mt-1 flex items-baseline gap-2 mono text-xs">
      <span className="tracking-[0.14em] text-text">{result.ticker}</span>
      {result.price != null && <span className="text-muted">{money(result.price)}</span>}
      {result.changePct != null && (
        <span style={{ color: result.changePct >= 0 ? 'var(--good)' : 'var(--crit)' }}>
          {pct(result.changePct)}
        </span>
      )}
    </div>
  );

  const errorBlock = phase === 'error' && (
    <div className="px-6 py-8">
      <p className="mono text-[12px] text-crit">
        {/couldn't|unreachable|network|failed|fetch/i.test(error)
          ? "Couldn't reach the council — try again."
          : error}
      </p>
    </div>
  );

  const toastEl = toast && (
    <div className="fixed inset-x-0 bottom-24 z-50 flex justify-center px-6 md:bottom-8">
      <div className="rise-in flex items-center gap-2 rounded-lg border border-line-2 bg-panel-2 px-4 py-2.5 mono text-[11px] text-text shadow-lg">
        <span style={{ color: 'var(--good)' }}><Icon name="check" size={13} /></span>
        {toast}
      </div>
    </div>
  );

  /* ---- desktop ---- */
  if (desktop) {
    return (
      <div className="flex h-full flex-col">
        <TickerBar value={ticker} onChange={setTicker} onSubmit={() => run(ticker)} busy={busy} bar />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {phase === 'idle' && <EmptyState />}
          {busy && <WorkingGrid revealed={revealed} />}
          {errorBlock}
          {phase === 'done' && result && (
            <div className="px-8 py-6">
              <div className="flex gap-8">
                <div className="min-w-0" style={{ flexBasis: '58%' }}>
                  {priceLine}
                  <div className="mt-3"><VerdictBanner r={result} /></div>
                  {proceedBtn}
                </div>
                <div className="shrink-0" style={{ flexBasis: '42%' }}>
                  <AgentCards result={result} className="grid grid-cols-2 gap-3" />
                </div>
              </div>
              <div className="mt-8 max-w-[900px]">
                <NewsStrip news={result.news} catalyst={result.catalyst} nextEarnings={result.nextEarnings} />
              </div>
            </div>
          )}
        </div>
        {toastEl}
      </div>
    );
  }

  /* ---- mobile ---- */
  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <TickerBar value={ticker} onChange={setTicker} onSubmit={() => run(ticker)} busy={busy} />
      {phase === 'idle' && <EmptyState />}
      {busy && <WorkingGrid revealed={revealed} />}
      {errorBlock}
      {phase === 'done' && result && (
        <div className="px-6 py-6">
          {priceLine}
          <div className="mt-3"><VerdictBanner r={result} /></div>
          {proceedBtn}
          <AgentCards result={result} className="mt-6 flex flex-col gap-3" />
          <div className="mt-6">
            <NewsStrip news={result.news} catalyst={result.catalyst} nextEarnings={result.nextEarnings} />
          </div>
        </div>
      )}
      {toastEl}
    </div>
  );
}
