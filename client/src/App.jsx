import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import Icon from './ui/Icon';
import { useNotifications } from './hooks/useNotifications';
import { useMedia } from './hooks/useMedia';
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
        <p className="mt-2 mono text-2xs tracking-[0.22em] text-faint">THE INVESTMENT COMMITTEE</p>
        <button onClick={signIn}
          className="mt-8 h-10 rounded-lg bg-lit px-6 mono text-[11px] font-medium tracking-wider text-base">
          Sign in with Google
        </button>
      </div>
    </div>
  );
}

function NavButton({ n, active, onClick, unread, wide }) {
  return (
    <button onClick={onClick} aria-current={active}
      className={`press relative flex items-center gap-1 transition-colors duration-200
        ${wide ? 'w-full flex-row rounded-lg px-3 py-2.5' : 'flex-col py-1.5'}
        ${active ? 'text-lit' : 'text-faint hover:text-muted'}`}>
      {wide && active && <span className="absolute left-0 top-1/2 h-4 w-[2px] -translate-y-1/2 rounded-full bg-accent shadow-[0_0_8px_var(--accent-glow)]" />}
      <span className="relative">
        <Icon name={n.icon} size={wide ? 18 : 19}
          style={active ? { filter: 'drop-shadow(0 0 6px rgba(243,239,226,0.4))' } : undefined} />
        {n.id === 'alerts' && unread > 0 && (
          <span className="absolute -right-2 -top-1.5 grid h-[14px] min-w-[14px] place-items-center rounded-full bg-crit px-1 mono text-[9px] leading-none text-white">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </span>
      <span className={`mono uppercase tracking-[0.1em] ${wide ? 'text-[10px]' : 'text-2xs'}`}>{n.label}</span>
    </button>
  );
}

export default function App() {
  const { user } = useAuth();
  const [view, setView] = useState('book');
  const { unread } = useNotifications(20);
  const desktop = useMedia('(min-width: 860px)');

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

  const stubs = {
    floor: <Stub icon="floor" title="THE FLOOR"
      note="The full desk — what the council has settled, last night's brief, the event desk, the agents' rooms. Next build."
      items={['Convene the desk (with feedback)', 'Desk notes browser', 'Opportunities from the sweep', 'Multi-agent chat rooms']} />,
    run: <Stub icon="run" title="RUN THE COUNCIL"
      note="Pick a ticker, watch the six analysts work their checks, the verdict lands on the floor."
      items={['Check-by-check as each agent finishes', 'Verdict + conviction + the impact line', 'Proceed → an execution thread']} />,
    alerts: <Stub icon="alerts" title="ALERTS"
      note="One feed of everything, filterable by kind, with the full 'what it means for the book' detail."
      items={['Filter by kind', 'Per-notification detail + actions', 'Notification preferences']} />,
    you: <Stub icon="you" title="YOU"
      note="Account, contributions, broker, notification preferences, job health, backtest."
      items={['Contribution ledger', 'Notification prefs + quiet hours', 'Scheduled jobs', 'Strategy vs the index']} />,
  };

  const content = view === 'book'
    ? <Book desktop={desktop} onOpenAgent={() => setView('run')} onOpenAlert={() => setView('alerts')} />
    : stubs[view];

  if (desktop) {
    return (
      <div className="flex h-dvh bg-base">
        <nav className="flex w-[168px] shrink-0 flex-col gap-1 border-r border-line bg-base-2 p-3">
          <div className="px-3 pb-4 pt-2 font-wide text-sm font-bold tracking-tight text-lit">AXIOM</div>
          {NAV.map((n) => (
            <NavButton key={n.id} n={n} wide active={view === n.id} unread={unread} onClick={() => setView(n.id)} />
          ))}
        </nav>
        <main className="min-w-0 flex-1">{content}</main>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-base" style={{ paddingTop: 'env(safe-area-inset-top)' }}>
      <main className="min-h-0 flex-1">{content}</main>
      <nav className="grid shrink-0 grid-cols-5 border-t border-line bg-base-2 px-2"
        style={{ paddingBottom: 'calc(8px + env(safe-area-inset-bottom))', paddingTop: '9px' }}>
        {NAV.map((n) => (
          <NavButton key={n.id} n={n} active={view === n.id} unread={unread}
            onClick={() => setView(n.id)} />
        ))}
      </nav>
    </div>
  );
}
