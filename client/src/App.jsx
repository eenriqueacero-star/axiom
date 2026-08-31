import { useAuth } from './AuthProvider';
import Login from './components/Login';
import Analyze from './components/Analyze';

export default function App() {
  const { user, signOut } = useAuth();

  if (user === undefined) {
    return (
      <div className="min-h-dvh grid place-items-center text-haze text-sm">
        Loading…
      </div>
    );
  }

  if (!user) return <Login />;

  return (
    <div className="min-h-dvh">
      <header className="sticky top-0 z-10 backdrop-blur bg-ink-950/80 border-b hairline">
        <div className="mx-auto max-w-3xl px-4 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm tracking-widest text-indigo-400">AXIOM</span>
          </div>
          <button
            onClick={signOut}
            className="text-xs text-haze hover:text-neutral-300 transition-colors"
          >
            {user.email} · sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Analyze />
      </main>
    </div>
  );
}
