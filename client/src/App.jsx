import { useState, lazy, Suspense } from 'react';
import { useAuth } from './AuthProvider';
import Login from './components/Login';
import Analyze from './components/Analyze';
import Portfolio from './components/Portfolio';
import Scorecard from './components/Scorecard';
import TheFloor from './components/TheFloor';
import SystemStatus from './components/SystemStatus';

const Floor3D = lazy(() => import('./components/Floor3D'));

export default function App() {
  const { user, signOut } = useAuth();
  const [statusOpen, setStatusOpen] = useState(false);
  const [view, setView] = useState('portfolio'); // 'portfolio' | 'analyze'
  const [analyzeTicker, setAnalyzeTicker] = useState('');
  const [floor3d, setFloor3d] = useState(() => {
    try { return localStorage.getItem('axiom.floor3d') !== '0'; } catch { return true; }
  });
  const setFloorMode = (on) => {
    setFloor3d(on);
    try { localStorage.setItem('axiom.floor3d', on ? '1' : '0'); } catch { /* ignore */ }
  };

  if (user === undefined) {
    return (
      <div className="min-h-dvh grid place-items-center text-haze text-sm">Loading…</div>
    );
  }
  if (!user) return <Login />;

  const goAnalyze = (ticker) => {
    setAnalyzeTicker(ticker || '');
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

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 backdrop-blur bg-ink-950/80 border-b hairline">
        <div className="mx-auto max-w-3xl px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="font-mono text-sm tracking-widest text-indigo-400">AXIOM</span>
            <button
              onClick={() => setStatusOpen(true)}
              title="System status"
              className="h-2 w-2 rounded-full bg-emerald-400 hover:ring-2 hover:ring-emerald-400/40"
            />
          </div>
          <button
            onClick={signOut}
            className="text-xs text-haze hover:text-neutral-300 transition-colors"
          >
            {user.email} · sign out
          </button>
        </div>
        <div className="mx-auto max-w-3xl px-4 flex gap-4">
          {tab('portfolio', 'Portfolio')}
          {tab('analyze', 'Analyze')}
          {tab('floor', 'The Floor')}
          {tab('scorecard', 'Scorecard')}
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-6">
        {view === 'portfolio' && <Portfolio onAnalyze={goAnalyze} />}
        {view === 'analyze' && <Analyze initialTicker={analyzeTicker} />}
        {view === 'floor' && (
          floor3d ? (
            <Suspense fallback={<p className="text-xs text-haze animate-pulse">Loading the floor…</p>}>
              <Floor3D onAnalyze={goAnalyze} onExit={() => setFloorMode(false)} />
            </Suspense>
          ) : (
            <div className="space-y-3">
              <button
                onClick={() => setFloorMode(true)}
                className="text-[11px] text-haze hover:text-neutral-300"
              >
                ← 3D view
              </button>
              <TheFloor onAnalyze={goAnalyze} />
            </div>
          )
        )}
        {view === 'scorecard' && <Scorecard />}
      </main>

      <SystemStatus open={statusOpen} onClose={() => setStatusOpen(false)} />
    </div>
  );
}
