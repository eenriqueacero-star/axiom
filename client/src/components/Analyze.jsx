import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, limit } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../AuthProvider';
import { getAgents, runCouncil } from '../api';
import AgentCard from './AgentCard';
import VerdictBanner from './VerdictBanner';
import NewsPanel from './NewsPanel';
import { verdictStyle, tierStyle } from './stance';

export default function Analyze({ initialTicker = '', runNonce = 0, onOpenBoss }) {
  const { user } = useAuth();
  const [agents, setAgents] = useState([]);
  const [ticker, setTicker] = useState(initialTicker);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    getAgents().then(setAgents).catch(() => setError('Could not load agents'));
  }, []);

  // Auto-run when arriving from a Portfolio ticker tap. `runNonce` bumps on
  // every tap so the same ticker re-runs instead of showing a stale result.
  useEffect(() => {
    if (initialTicker && /^[A-Z.\-]{1,10}$/.test(initialTicker)) {
      setTicker(initialTicker);
      setError('');
      setRunning(true);
      setCurrent(null);
      runCouncil(initialTicker)
        .then(setCurrent)
        .catch((err) => setError(err.message))
        .finally(() => setRunning(false));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialTicker, runNonce]);

  // Realtime history — updates live across every signed-in device.
  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, `users/${user.uid}/analyses`),
      orderBy('ts', 'desc'),
      limit(25),
    );
    return onSnapshot(q, (snap) => {
      setHistory(snap.docs.map((d) => ({ id: d.id, ...d.data() })));
    });
  }, [user]);

  const run = async (e, force = false) => {
    e?.preventDefault();
    const sym = (force ? current?.ticker : ticker).toUpperCase().trim();
    if (!/^[A-Z.\-]{1,10}$/.test(sym)) {
      setError('Enter a valid ticker');
      return;
    }
    setError('');
    setRunning(true);
    if (!force) setCurrent(null);
    try {
      const result = await runCouncil(sym, force);
      setCurrent(result);
    } catch (err) {
      setError(err.message);
    } finally {
      setRunning(false);
    }
  };

  const shown = current;
  const agentList = useMemo(() => agents, [agents]);

  return (
    <div className="space-y-6">
      <form onSubmit={run} className="flex gap-2">
        <input
          value={ticker}
          onChange={(e) => setTicker(e.target.value.toUpperCase())}
          placeholder="Ticker — e.g. NVDA"
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          className="flex-1 h-11 px-3 rounded-lg bg-ink-900 border border-ink-800 text-sm font-mono tracking-wider placeholder:text-ink-600 focus:outline-none focus:border-indigo-500/60"
        />
        <button
          type="submit"
          disabled={running}
          className="h-11 px-5 rounded-lg bg-indigo-500 text-white text-sm font-medium hover:bg-indigo-400 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          {running ? 'Convening…' : 'Convene'}
        </button>
      </form>

      {error && <p className="text-xs text-red-400">{error}</p>}

      {running && (
        <p className="text-xs text-haze animate-pulse">
          The council is deliberating. This takes ~10–20s.
        </p>
      )}

      {shown && (
        <div className="space-y-4">
          <VerdictBanner analysis={shown} onOpenBoss={onOpenBoss} />
          <div className="flex items-center justify-between text-xs text-haze">
            <span>
              {shown.cached ? 'Reused a recent run' : 'Fresh run'}
              {shown.ts ? ` · ${new Date(shown.ts).toLocaleString()}` : ''}
            </span>
            <button
              onClick={() => run(null, true)}
              disabled={running}
              className="text-indigo-400 hover:text-indigo-300 disabled:opacity-50"
            >
              {running ? 'Re-running…' : 'Re-run council'}
            </button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {agentList.map((a) => (
              <AgentCard key={a.id} agent={a} result={shown.agents?.[a.id]} />
            ))}
          </div>
          <NewsPanel news={shown.news} catalyst={shown.catalyst} />
        </div>
      )}

      {running && !shown && (
        <div className="grid gap-3 sm:grid-cols-2">
          {agentList.map((a) => (
            <AgentCard key={a.id} agent={a} loading />
          ))}
        </div>
      )}

      {history.length > 0 && (
        <section className="pt-2">
          <h2 className="text-[11px] uppercase tracking-widest text-haze mb-2">Recent</h2>
          <ul className="divide-y divide-ink-800 card overflow-hidden">
            {history.map((h) => {
              const v = verdictStyle(h.verdict);
              return (
                <li key={h.id}>
                  <button
                    onClick={() => setCurrent(h)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-ink-850 transition-colors text-left"
                  >
                    <div className="flex items-center gap-3">
                      <span className="font-mono text-sm text-neutral-200">{h.ticker}</span>
                      <span className="text-xs text-haze">
                        {new Date(h.ts).toLocaleDateString()}
                      </span>
                    </div>
                    <span className="text-xs font-semibold flex items-baseline gap-2" style={{ color: v.fg }}>
                      {tierStyle(h.tier) && (
                        <span className="font-mono text-[10px] tracking-wider opacity-70" style={{ color: tierStyle(h.tier).fg }}>
                          {tierStyle(h.tier).label}
                        </span>
                      )}
                      {h.verdict} · {h.conviction}/10
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </div>
  );
}
