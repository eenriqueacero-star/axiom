import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import Login from './components/Login';
import Analyze from './components/Analyze';
import Portfolio from './components/Portfolio';
import Scorecard from './components/Scorecard';
import Congress from './components/Congress';
import TheFloor from './components/TheFloor';
import TheOffice from './components/TheOffice';
import SystemStatus from './components/SystemStatus';
import KeyStatusPill from './components/KeyStatusPill';
import BossChat from './components/BossChat';
import { getBossThreads } from './api';


export default function App() {
  const { user, signOut } = useAuth();
  const [statusOpen, setStatusOpen] = useState(false);
  const [bossOpen, setBossOpen] = useState(false);
  const [bossThreadId, setBossThreadId] = useState(null);
  const [bossUnread, setBossUnread] = useState(false);
  const [view, setView] = useState('portfolio'); // 'portfolio' | 'analyze'
  const [analyzeTicker, setAnalyzeTicker] = useState('');
  const [analyzeNonce, setAnalyzeNonce] = useState(0); // bumps to force a re-run on the same ticker

  // Deep links from push notifications: ?t=<ticker> opens Analyze on it,
  // ?chat=<id> opens the boss, ?tab=floor.
  useEffect(() => {
    if (!user) return;
    const p = new URLSearchParams(window.location.search);
    const t = (p.get('t') || '').toUpperCase();
    if (/^[A-Z.\-]{1,10}$/.test(t)) { setAnalyzeTicker(t); setAnalyzeNonce((n) => n + 1); setView('analyze'); }
    if (p.get('chat')) { setBossThreadId(p.get('chat')); setBossOpen(true); }
    if (p.get('tab') === 'floor') setView('floor');
    if (p.get('chat') || p.get('tab') || p.get('t')) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [user]);

  // Poll for an unread ping from the boss.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    const check = () => getBossThreads()
      .then((r) => { if (alive) setBossUnread((r.threads || []).some((t) => t.unread)); })
      .catch(() => {});
    check();
    const id = setInterval(check, 90_000);
    return () => { alive = false; clearInterval(id); };
  }, [user, bossOpen]);
  const [roomView, setRoomView] = useState(() => {
    try { return localStorage.getItem('axiom.roomView') !== '0'; } catch { return true; }
  });
  const setRoom = (on) => {
    setRoomView(on);
    try { localStorage.setItem('axiom.roomView', on ? '1' : '0'); } catch { /* ignore */ }
  };

  if (user === undefined) {
    return (
      <div className="min-h-dvh grid place-items-center text-haze text-sm">Loading…</div>
    );
  }
  if (!user) return <Login />;

  const goAnalyze = (ticker) => {
    setAnalyzeTicker(ticker || '');
    setAnalyzeNonce((n) => n + 1);   // re-run even if it's the same ticker as last time
    setView('analyze');
  };

  const tab = (id, label) => (
    <button
      onClick={() => setView(id)}
      className={`text-xs pb-1 border-b-2 transition-colors ${
        view === id
          ? 'border-indigo-400 text-neutral-100'
          : 'border-transparent text-haze hover:text-neutral-300'
      }`}
    >
      {label}
    </button>
  );

  const wide = view === 'portfolio' || view === 'congress' || (view === 'floor' && roomView);
  const shell = view === 'floor' && roomView ? 'max-w-6xl' : wide ? 'max-w-5xl' : 'max-w-3xl';

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 backdrop-blur bg-ink-950/80 border-b hairline">
        <div className={`mx-auto ${shell} px-4 h-14 flex items-center justify-between`}>
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm tracking-widest text-indigo-400">AXIOM</span>
            <KeyStatusPill onOpen={() => setStatusOpen(true)} />
            <button
              onClick={() => { setBossThreadId(null); setBossOpen(true); }}
              title="Talk to the boss"
              className="relative text-[11px] text-haze hover:text-neutral-200"
            >
              boss
              {bossUnread && <span className="absolute -top-1 -right-2 h-1.5 w-1.5 rounded-full bg-indigo-400" />}
            </button>
          </div>
          <button
            onClick={signOut}
            className="text-xs text-haze hover:text-neutral-300 transition-colors"
          >
            {user.email} · sign out
          </button>
        </div>
        <div className={`mx-auto ${shell} px-4 flex gap-4`}>
          {tab('portfolio', 'Portfolio')}
          {tab('analyze', 'Analyze')}
          {tab('floor', 'The Floor')}
          {tab('congress', 'Congress')}
          {tab('scorecard', 'Scorecard')}
        </div>
      </header>
      <main className={`mx-auto px-4 py-6 ${shell}`}>
        {view === 'portfolio' && <Portfolio onAnalyze={goAnalyze} />}
        {view === 'analyze' && (
          <Analyze
            initialTicker={analyzeTicker}
            runNonce={analyzeNonce}
            onOpenBoss={(threadId) => { setBossThreadId(threadId); setBossOpen(true); }}
          />
        )}
        {view === 'floor' && (
          roomView
            ? <TheOffice onAnalyze={goAnalyze} onExit={() => setRoom(false)} />
            : (
              <div className="space-y-3">
                <button onClick={() => setRoom(true)} className="text-[11px] text-haze hover:text-neutral-300">
                  floor view
                </button>
                <TheFloor onAnalyze={goAnalyze} />
              </div>
            )
        )}
        {view === 'congress' && <Congress onAnalyze={goAnalyze} />}
        {view === 'scorecard' && <Scorecard />}
      </main>

      <SystemStatus open={statusOpen} onClose={() => setStatusOpen(false)} />
      <BossChat open={bossOpen} initialThreadId={bossThreadId} onClose={() => setBossOpen(false)} />
    </div>
  );
}
