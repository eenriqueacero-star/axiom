import { useState } from 'react';
import { useAuth } from '../AuthProvider';

export default function Login() {
  const { signIn } = useAuth();
  const [err, setErr] = useState('');

  const handle = async () => {
    setErr('');
    try {
      await signIn();
    } catch (e) {
      setErr(e.message || 'Sign-in failed');
    }
  };

  return (
    <div className="min-h-dvh grid place-items-center px-4">
      <div className="w-full max-w-sm text-center">
        <div className="font-mono text-lg tracking-[0.3em] text-indigo-400 mb-2">AXIOM</div>
        <p className="text-haze text-sm mb-8">Your private investment council.</p>
        <button
          onClick={handle}
          className="w-full h-11 rounded-lg bg-white text-ink-950 font-medium text-sm hover:bg-neutral-200 transition-colors"
        >
          Continue with Google
        </button>
        {err && <p className="mt-4 text-xs text-red-400">{err}</p>}
      </div>
    </div>
  );
}
