import { useState } from 'react';
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


export default function App() {
  const { user, signOut } = useAuth();
  const [statusOpen, setStatusOpen] = useState(false);
  const [view, setView] = useState('portfolio'); // 'portfolio' | 'analyze'
  const [analyzeTicker, setAnalyzeTicker] = useState('');
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
        {view === 'analyze' && <Analyze initialTicker={analyzeTicker} />}
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
    </div>
  );
}
