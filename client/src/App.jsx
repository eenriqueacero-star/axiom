import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import Icon from './ui/Icon';
import { useNotifications } from './hooks/useNotifications';
import Book from './views/Book';
import Stub from './views/Stub';

const NAV = [
  { id: 'book',   icon: 'book',   label: 'Book' },
  { id: 'floor',  icon: 'floor',  label: 'Floor' },
  { id: 'run',    icon: 'run',    label: 'Run' },
  { id: 'alerts', icon: 'alerts', label: 'Alerts' },
  { id: 'you',    icon: 'you',    label: 'You' },
];

function Login() {
  const { signIn } = useAuth();
  return (
    <div className="grid min-h-dvh place-items-center bg-base px-6">
      <div className="text-center">
        <div className="font-wide text-2xl font-bold tracking-tight text-lit">AXIOM</div>
        <p className="mt-2 mono text-[10px] tracking-[0.22em] text-faint">THE INVESTMENT COMMITTEE</p>
        <button onClick={signIn}
          className="mt-8 h-10 rounded-lg bg-lit px-6 mono text-[11px] font-medium tracking-wider text-base">
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const { user } = useAuth();
  const [view, setView] = useState('book');
  const { unread } = useNotifications(20);

  // deep links from push / notifications
  useEffect(() => {
    if (!user) return;
    const p = new URLSearchParams(window.location.search);
    if (p.get('tab') === 'notifications' || p.get('n')) setView('alerts');
    else if (p.get('tab') === 'floor') setView('floor');
    else if (p.get('t')) setView('run');
    if ([...p.keys()].length) window.history.replaceState({}, '', window.location.pathname);
  }, [user]);

  if (user === undefined) {
    return <div className="grid min-h-dvh place-items-center bg-base mono text-[11px] text-faint">Opening the floor…</div>;
  }
  if (!user) return <Login />;

  return (
    <div className="mx-auto flex h-dvh max-w-md flex-col bg-base" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <main className="min-h-0 flex-1">
        {view === 'book' && <Book onOpenAgent={(t) => setView('run')} onOpenAlert={() => setView('alerts')} />}
        {view === 'floor' && <Stub icon="floor" title="THE FLOOR"
          note="The full desk — what the council has settled, last night's brief, the event desk, and the agents' rooms. Next build."
          items={['Convene the desk (with feedback when it no-ops)', 'Desk notes browser', 'Opportunities from the inbox sweep', 'Multi-agent chat rooms']} />}
        {view === 'run' && <Stub icon="run" title="RUN THE COUNCIL"
          note="Pick a ticker and watch the six analysts work their checks — the verdict lands on the floor. Replaces the old Analyze tab."
          items={['Live check-by-check as each agent finishes', 'Verdict + conviction + the impact line', 'Proceed → an execution thread with the boss']} />}
        {view === 'alerts' && <Stub icon="alerts" title="ALERTS"
          note="One feed of everything — verdict changes, filings, congress trades, the boss's reads — filterable by kind, with the full 'what it means for the book' detail."
          items={['Filter by kind (news / filing / rating / congress / …)', 'Per-notification detail + actions', 'Notification preferences']} />}
        {view === 'you' && <Stub icon="you" title="YOU"
          note="Account, contributions, connected broker, notification preferences, job health, backtest — everything that was scattered across System Status and Scorecard."
          items={['Contribution ledger', 'Notification prefs + quiet hours', 'Scheduled jobs — all green?', 'Strategy vs the index']} />}
      </main>

      <nav className="grid shrink-0 grid-cols-5 border-t border-line bg-base-2 px-2"
        style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom))', paddingTop: '9px' }}>
        {NAV.map((n) => (
          <button key={n.id} onClick={() => setView(n.id)} aria-current={view === n.id}
            className={`flex flex-col items-center gap-1 py-1.5 mono text-[8px] uppercase tracking-[0.1em] transition-colors
              ${view === n.id ? 'text-lit' : 'text-faint'}`}>
            <span className="relative">
              <Icon name={n.icon} size={19}
                style={view === n.id ? { filter: 'drop-shadow(0 0 6px rgba(243,239,226,0.4))' } : undefined} />
              {n.id === 'alerts' && unread > 0 && (
                <span className="absolute -right-2 -top-1.5 grid h-[14px] min-w-[14px] place-items-center rounded-full bg-crit px-1 mono text-[9px] leading-none text-white">
                  {unread > 9 ? '9+' : unread}
                </span>
              )}
            </span>
            {n.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
