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
import Notifications, { useNotifications } from './components/Notifications';
import { getBossThreads } from './api';
import { navlog } from './lib/navdebug';


export default function App() {
  const { user, signOut } = useAuth();
  const [statusOpen, setStatusOpen] = useState(false);
  const [bossOpen, setBossOpen] = useState(false);
  const [bossThreadId, setBossThreadId] = useState(null);
  const [bossUnread, setBossUnread] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [notifOpenId, setNotifOpenId] = useState(null);
  const [navToast, setNavToast] = useState('');
  const [catchUpAt, setCatchUpAt] = useState(0);
  const notifFeed = useNotifications();
  const [view, setView] = useState('portfolio'); // 'portfolio' | 'analyze'
  const [analyzeTicker, setAnalyzeTicker] = useState('');
  const [analyzeNonce, setAnalyzeNonce] = useState(0); // bumps to force a re-run on the same ticker

  // Deep links from push notifications: ?n=<id> opens that notification,
  // ?t=<ticker> opens Analyze, ?chat=<id> opens the boss, ?tab=floor|notifications.
  const applyDeepLink = (search) => {
    const p = new URLSearchParams(search || '');
    const t = (p.get('t') || '').toUpperCase();
    if (/^[A-Z.\-]{1,10}$/.test(t)) { setAnalyzeTicker(t); setAnalyzeNonce((n) => n + 1); setView('analyze'); }
    if (p.get('chat')) { setBossThreadId(p.get('chat')); setBossOpen(true); }
    if (p.get('tab') === 'floor') setView('floor');
    if (p.get('tab') === 'notifications') setNotifOpen(true);
    if (p.get('n')) { setNotifOpen(true); setNotifOpenId(p.get('n')); }
  };

  useEffect(() => {
    if (!user) return;
    applyDeepLink(window.location.search);
    if (window.location.search) {
      window.history.replaceState({}, '', window.location.pathname);
    }
  }, [user]);

  // Notification routing. iOS standalone PWAs won't act on postMessage or
  // navigate() while backgrounded — but when the PWA is brought forward the
  // page becomes visible again, so we re-check a route the SW stashed in the
  // Cache API on every resume. postMessage covers desktop/Android.
  useEffect(() => {
    if (!user) return;
    let done = false;
    let routedRecently = 0;

    const applyPath = (path, via) => {
      if (!path) return;
      routedRecently = Date.now();
      navlog(`nav applied (${via}): ${path}`);
      setNavToast(`→ ${path}`);
      setTimeout(() => setNavToast(''), 4000);
      const qs = path.includes('?') ? path.split('?')[1] : '';
      applyDeepLink(qs);
    };

    const consumePending = async (via) => {
      if (done) return;
      let routed = false;
      try {
        const cache = await caches.open('axiom-nav');
        const res = await cache.match('pending');
        if (res) {
          const raw = await res.text();
          await cache.delete('pending');
          let path = raw, ts = Date.now();
          try { const o = JSON.parse(raw); path = o.path; ts = o.ts || ts; } catch { /* legacy plain string */ }
          const ageMs = Date.now() - ts;
          // A real notification tap foregrounds the app within seconds. Anything
          // older is almost certainly a manual open (iOS gives us no tap signal),
          // so we fall through to the "catch up on what's new" behaviour instead.
          if (ageMs <= 25_000) {
            applyPath(path, via || 'cache');
            routed = true;
          } else {
            navlog(`resume (${via}) — stale route, will catch up (${Math.round(ageMs / 1000)}s)`);
          }
        } else {
          navlog(`resume (${via}) — no pending nav`);
        }
      } catch (e) { navlog(`cache read failed: ${e.message}`); }
      // Not a fresh deep-link (and none applied moments ago on this resume) →
      // ask the feed effect to surface anything unread.
      if (!routed && Date.now() - routedRecently > 3000) setCatchUpAt(Date.now());
    };

    const onMsg = (e) => {
      if (e.data?.type === 'axiom-nav' && e.data.path) applyPath(e.data.path, 'message');
    };
    const onVis = () => { if (document.visibilityState === 'visible') consumePending('visibility'); };

    const onFocus = () => consumePending('focus');
    const onShow = () => consumePending('pageshow');
    if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', onMsg);
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('pageshow', onShow);
    consumePending('mount');

    return () => {
      done = true;
      if ('serviceWorker' in navigator) navigator.serviceWorker.removeEventListener('message', onMsg);
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('pageshow', onShow);
    };
  }, [user]);

  // Returning to the app (not a fresh deep-link) — if notifications arrived while
  // you were away, open the alerts list so you see what's new without hunting.
  useEffect(() => {
    if (!catchUpAt || !notifFeed.items.length) return;
    if (Date.now() - catchUpAt > 8000) return;  // only right after a resume
    let lastSeen = 0;
    try { lastSeen = Number(localStorage.getItem('axiom.lastSeenNotif')) || 0; } catch { /* ignore */ }
    const fresh = notifFeed.items.filter((n) => !n.read && (n.ts || 0) > lastSeen);
    if (fresh.length) {
      navlog(`catch-up: ${fresh.length} unread since last visit → opening list`);
      setNotifOpen(true);
    }
    setCatchUpAt(0);
  }, [catchUpAt, notifFeed.items]);

  // Remember the newest notification the user has been shown.
  useEffect(() => {
    if (!notifOpen || !notifFeed.items.length) return;
    const newest = Math.max(...notifFeed.items.map((n) => n.ts || 0));
    try { localStorage.setItem('axiom.lastSeenNotif', String(newest)); } catch { /* ignore */ }
  }, [notifOpen, notifFeed.items]);

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

  const onNotifDeepLink = (d) => {
    if (d.analyze) goAnalyze(d.analyze);
    else if (d.chat) { setBossThreadId(d.chat); setBossOpen(true); }
    else if (d.tab) setView(d.tab);
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
      <header
        className="sticky top-0 z-10 backdrop-blur bg-ink-950/80 border-b hairline"
        style={{ paddingTop: 'env(safe-area-inset-top)' }}
      >
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
            <button
              onClick={() => setNotifOpen(true)}
              title="Notifications"
              className="relative text-[11px] text-haze hover:text-neutral-200"
            >
              alerts
              {notifFeed.unread > 0 && (
                <span className="absolute -top-1.5 -right-2.5 min-w-[14px] h-[14px] px-1 rounded-full bg-red-500 text-white text-[9px] font-mono leading-[14px] text-center">
                  {notifFeed.unread > 9 ? '9+' : notifFeed.unread}
                </span>
              )}
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
      <Notifications
        open={notifOpen}
        openId={notifOpenId}
        feed={notifFeed}
        onClose={() => { setNotifOpen(false); setNotifOpenId(null); }}
        onDeepLink={onNotifDeepLink}
      />
      {navToast && (
        <div className="fixed bottom-4 inset-x-0 z-50 flex justify-center px-4 pointer-events-none">
          <div className="bg-indigo-500 text-white text-[11px] font-mono px-3 py-1.5 rounded-full shadow-lg">
            {navToast}
          </div>
        </div>
      )}
    </div>
  );
}
