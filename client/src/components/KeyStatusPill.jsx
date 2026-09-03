import { useEffect, useState } from 'react';
import { getKeyStatus } from '../api';

const tone = (live, total) => {
  if (!total) return 'text-ink-600';
  if (live === total) return 'text-emerald-400';
  if (live === 0) return 'text-red-400';
  return 'text-amber-400';
};

/** Always-on key health in the header. Click opens the full status panel. */
export default function KeyStatusPill({ onOpen }) {
  const [k, setK] = useState(null);

  useEffect(() => {
    let alive = true;
    const load = () => getKeyStatus().then((d) => { if (alive) setK(d); }).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!k) {
    return <span className="h-2 w-2 rounded-full bg-ink-600 animate-pulse" title="Checking keys…" />;
  }

  const nvTotal = k.nvidiaTotal || 0;

  return (
    <button
      onClick={onOpen}
      title="API key health — click for detail"
      className="flex items-center gap-2 font-mono text-[10px] tracking-wide hover:opacity-80"
    >
      <span className={tone(k.live, k.total)}>GROQ {k.live}/{k.total}</span>
      <span className="text-ink-700">·</span>
      <span className={tone(k.nvidiaLive || 0, nvTotal)}>
        NV {nvTotal ? `${k.nvidiaLive || 0}/${nvTotal}` : '—'}
      </span>
      {k.synthProvider === 'nvidia' && <span className="text-indigo-400" title="Synthesis routed through NVIDIA strong model">★</span>}
    </button>
  );
}
