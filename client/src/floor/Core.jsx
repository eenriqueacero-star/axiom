import { useEffect, useRef } from 'react';
import Icon, { AGENT_META } from '../ui/Icon';

/**
 * The living core — the portfolio as an organism — with the six analysts around
 * it. The core's shape leans toward concentration, its rim flickers per rule
 * breach, its inner glow takes the day's colour. A packet only crosses a cable
 * when that agent is actually working. Everything else is ambient breath.
 *
 * props:
 *   agents:   [{ id, work: { task, startedMs, pct } | null }]
 *   sectors:  [{ name, pct }]         — drives the core's form
 *   breaches: number
 *   dayPct:   number | null            — today's move, for the inner glow
 *   onAgent:  (id) => void
 *   onCore:   () => void
 */
export default function Core({ agents = [], sectors = [], breaches = 0, dayPct = 0, onAgent, onCore }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const nodeRefs = useRef({});
  const state = useRef({ agents, sectors, breaches, dayPct });
  state.current = { agents, sectors, breaches, dayPct };

  const RM = typeof window !== 'undefined'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const DPR = Math.min(2, window.devicePixelRatio || 1);
    let W = 0, H = 0, cx = 0, cy = 0, coreR = 0;
    const pos = {};                // agent id -> {x,y}
    const orbs = [];
    const timers = {};
    let raf = 0;

    const AG = () => state.current.agents;
    const ids = () => AG().map((a) => a.id);

    function layout() {
      const r = wrap.getBoundingClientRect();
      W = r.width; H = r.height;
      canvas.width = W * DPR; canvas.height = H * DPR;
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

      // Lay agents on an ellipse inside a CENTERED stage. The stage scales with
      // the viewport but stays roughly square so a wide desktop doesn't stretch
      // the constellation and a phone doesn't cramp it.
      const wide = W >= 760;
      const stageW = Math.min(W - (wide ? 48 : 16), H * 1.12, wide ? 760 : 600);
      const stageH = Math.min(H - 12, wide ? 640 : 560);
      const S = Math.min(stageW, stageH);
      cx = W / 2; cy = H / 2 - 2;
      coreR = S * (wide ? 0.205 : 0.17);
      const rx = stageW * (wide ? 0.47 : 0.45);
      const ry = stageH * (wide ? 0.46 : 0.44);

      const list = ids();
      list.forEach((id, i) => {
        const ang = -Math.PI / 2 + (i * Math.PI * 2) / list.length;
        const x = cx + Math.cos(ang) * rx;
        const y = cy + Math.sin(ang) * ry;
        pos[id] = { x, y };
        const el = nodeRefs.current[id];
        if (el) { el.style.left = `${x}px`; el.style.top = `${y}px`; }
      });
    }
    layout();
    requestAnimationFrame(layout);
    const ro = new ResizeObserver(layout);
    ro.observe(wrap);
    if (document.fonts?.ready) document.fonts.ready.then(layout);

    /* an orb only when info genuinely moves — a working agent's query/finding */
    function sendOrb(id, dir) {
      const a = AG().find((x) => x.id === id);
      if (!a?.work) return;
      orbs.push({ id, p: 0, dir, color: AGENT_META[id]?.hex || '#8a8a93' });
    }
    function scheduleExchange(id) {
      clearTimeout(timers[id]);
      const a = AG().find((x) => x.id === id);
      if (!a?.work || RM) return;
      timers[id] = setTimeout(() => {
        sendOrb(id, 1);
        setTimeout(() => sendOrb(id, -1), 1300 + Math.random() * 900);
        scheduleExchange(id);
      }, 5000 + Math.random() * 8000);
    }
    ids().forEach(scheduleExchange);
    // re-arm when work state changes
    const reArm = setInterval(() => ids().forEach((id) => {
      const a = AG().find((x) => x.id === id);
      if (a?.work && !timers[id]) scheduleExchange(id);
      if (!a?.work && timers[id]) { clearTimeout(timers[id]); delete timers[id]; }
    }), 3000);

    function lobes() {
      const s = state.current.sectors.slice(0, 5);
      const tot = s.reduce((n, x) => n + (x.pct || 0), 0) || 1;
      return s.map((x, i) => ({
        ang: (i / Math.max(1, s.length)) * Math.PI * 2 - 0.5,
        amp: Math.min(0.26, (x.pct / tot) * 0.4),
        w: 1.6 + i * 0.5,
      }));
    }

    let t0 = performance.now();
    function frame(now) {
      const t = (now - t0) / 1000;
      const { breaches: BR, dayPct: dp } = state.current;
      ctx.clearRect(0, 0, W, H);
      const breath = RM ? 0.5 : Math.sin((t * Math.PI * 2) / 6) * 0.5 + 0.5;
      const spin = RM ? 0 : t * 0.1;
      const LB = lobes();

      /* cables — quiet static, lit in the agent's colour while working;
         a faint breath keeps them from looking dead */
      const cb = RM ? 0.04 : 0.03 + Math.sin(t * 0.7) * 0.012;
      AG().forEach((a) => {
        const p = pos[a.id]; if (!p) return;
        ctx.beginPath();
        ctx.moveTo(cx, cy); ctx.lineTo(p.x, p.y);
        ctx.strokeStyle = a.work ? `${AGENT_META[a.id]?.hex || '#888'}30` : `rgba(255,255,255,${cb})`;
        ctx.lineWidth = a.work ? 1.1 : 1;
        ctx.stroke();
      });

      /* ambient — a slow, faint ring of motes orbiting the core */
      if (!RM) {
        const ringR = coreR * 1.9;
        for (let m = 0; m < 7; m++) {
          const a = (m / 7) * Math.PI * 2 + t * 0.08 * (m % 2 ? 1 : -1);
          const rr = ringR * (1 + Math.sin(t * 0.5 + m) * 0.05);
          const mx = cx + Math.cos(a) * rr;
          const my = cy + Math.sin(a) * rr * 0.9;
          ctx.beginPath();
          ctx.arc(mx, my, 0.9, 0, 7);
          ctx.fillStyle = `rgba(243,239,226,${0.06 + 0.05 * Math.abs(Math.sin(t + m))})`;
          ctx.fill();
        }
      }

      /* orbs with a short trail */
      for (let k = orbs.length - 1; k >= 0; k--) {
        const o = orbs[k];
        o.p += 0.02;
        if (o.p >= 1) { orbs.splice(k, 1); continue; }
        const p = pos[o.id]; if (!p) continue;
        const from = o.dir > 0 ? 1 - o.p : o.p;   // fraction toward the core
        for (let s = 0; s < 5; s++) {
          const f = Math.max(0, from - s * 0.05);
          const x = p.x + (cx - p.x) * (1 - f);
          const y = p.y + (cy - p.y) * (1 - f);
          ctx.beginPath();
          ctx.arc(x, y, 1.6 - s * 0.28, 0, 7);
          ctx.fillStyle = o.color + Math.round((0.5 - s * 0.09) * 255).toString(16).padStart(2, '0');
          ctx.fill();
        }
      }

      /* the core */
      const R = coreR * (1 + breath * 0.05);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(spin);
      ctx.beginPath();
      const N = 96;
      for (let i = 0; i <= N; i++) {
        const a = (i / N) * Math.PI * 2;
        let rr = 1;
        LB.forEach((L) => {
          const d = ((a - L.ang + Math.PI) % (Math.PI * 2)) - Math.PI;
          rr += L.amp * Math.exp(-Math.pow(d * L.w, 2));
        });
        rr += Math.sin(a * 7 + t * 0.6) * 0.022
            + Math.sin(a * 13 - t * 0.9) * 0.011
            + Math.sin(a * 3 + t * 0.35) * 0.018;
        const x = Math.cos(a) * R * rr, y = Math.sin(a) * R * rr;
        i ? ctx.lineTo(x, y) : ctx.moveTo(x, y);
      }
      ctx.closePath();

      const up = (dp || 0) >= 0;
      const glow = ctx.createRadialGradient(0, 0, R * 0.15, 0, 0, R * 1.8);
      glow.addColorStop(0, up ? 'rgba(75,173,131,0.14)' : 'rgba(224,87,78,0.14)');
      glow.addColorStop(0.5, 'rgba(120,120,170,0.05)');
      glow.addColorStop(1, 'transparent');
      ctx.fillStyle = glow;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(243,239,226,0.26)';
      ctx.stroke();

      if (!RM) {
        for (let b = 0; b < BR; b++) {
          const a = (b / Math.max(1, BR)) * Math.PI * 2 + t * 0.3;
          let rr = 1;
          LB.forEach((L) => {
            const d = ((a - L.ang + Math.PI) % (Math.PI * 2)) - Math.PI;
            rr += L.amp * Math.exp(-Math.pow(d * L.w, 2));
          });
          const fl = 0.35 + 0.55 * Math.abs(Math.sin(t * 3 + b));
          ctx.beginPath();
          ctx.arc(Math.cos(a) * R * rr, Math.sin(a) * R * rr, 1.5, 0, 7);
          ctx.fillStyle = `rgba(224,87,78,${fl})`;
          ctx.fill();
        }
      }

      // the firm — a small steady core inside the churn
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.26, 0, 7);
      ctx.strokeStyle = 'rgba(243,239,226,0.5)';
      ctx.lineWidth = 1.1;
      ctx.stroke();
      const pd = 0.5 + 0.5 * Math.sin((t * Math.PI * 2) / 6 + Math.PI);
      ctx.beginPath();
      ctx.arc(0, 0, R * 0.09, 0, 7);
      ctx.fillStyle = `rgba(243,239,226,${0.32 + pd * 0.4})`;
      ctx.fill();
      ctx.restore();

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      clearInterval(reArm);
      Object.values(timers).forEach(clearTimeout);
    };
  }, [RM]);

  const elapsed = (ms) => {
    const s = Math.round((Date.now() - ms) / 1000);
    if (s < 60) return `${s}s`;
    if (s < 3600) { const m = Math.floor(s / 60), r = s % 60; return r ? `${m}m ${r}s` : `${m}m`; }
    return `${Math.floor(s / 3600)}h`;
  };
  const C = 2 * Math.PI * 20;

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden" onClick={onCore}>
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      {agents.map((a) => {
        const meta = AGENT_META[a.id] || { name: a.id.toUpperCase(), color: 'var(--muted)' };
        const on = !!a.work;
        return (
          <button
            key={a.id}
            ref={(el) => { nodeRefs.current[a.id] = el; }}
            onClick={(e) => { e.stopPropagation(); onAgent?.(a.id); }}
            data-work={on ? 'on' : 'idle'}
            style={{ color: meta.color }}
            aria-label={on
              ? `${meta.name}. Working: ${a.work.task}. ${elapsed(a.work.startedMs)} in, ${a.work.pct}% done.`
              : `${meta.name}. Idle.`}
            className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1
              w-[108px] md:w-[132px] p-1.5 data-[work=idle]:opacity-40 transition-opacity duration-500"
          >
            <span className="relative grid place-items-center rounded-full bg-panel border
              h-9 w-9 md:h-11 md:w-11"
              style={{ borderColor: on ? 'currentColor' : 'var(--line-2)' }}>
              {on && (
                <svg viewBox="0 0 44 44" className="absolute -inset-1 -rotate-90">
                  <circle cx="22" cy="22" r="20" fill="none" stroke="var(--line-2)" strokeWidth="1.6" />
                  <circle cx="22" cy="22" r="20" fill="none" stroke="currentColor" strokeWidth="1.6"
                    strokeLinecap="round" strokeDasharray={C}
                    strokeDashoffset={C * (1 - a.work.pct / 100)} className="transition-[stroke-dashoffset] duration-700" />
                </svg>
              )}
              {on && <span className="absolute -inset-1 rounded-full border border-current animate-[apulse_2.4s_ease-out_infinite]" />}
              <Icon name={a.id} size={15} className="md:hidden" />
              <Icon name={a.id} size={18} className="hidden md:block" />
            </span>
            <span className="mono tracking-[0.14em] mt-0.5 text-[9px] md:text-[10px]">{meta.name}</span>
            {on
              ? <>
                  <span className="leading-tight text-faint line-clamp-2 text-[9px] md:text-[10px] max-w-[108px] md:max-w-[132px]">{a.work.task}</span>
                  <span className="mono tracking-wider text-[8px] md:text-[9px]">{elapsed(a.work.startedMs)} · {a.work.pct}%</span>
                </>
              : <span className="mono tracking-wider text-faint text-[8px] md:text-[9px]">idle</span>}
          </button>
        );
      })}
      <style>{`@keyframes apulse{0%{opacity:.45;transform:scale(.85)}75%{opacity:0;transform:scale(1.3)}100%{opacity:0}}`}</style>
    </div>
  );
}
