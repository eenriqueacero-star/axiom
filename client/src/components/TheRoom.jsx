import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoundedBox, ContactShadows, useGLTF, useAnimations, Html } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { useControls, button, folder, Leva } from 'leva';
import * as THREE from 'three';
import { getFloor, getDeskState, convene } from '../api';
import { AgentPanel, AgentChat } from './floor/shared';
import { DEFAULTS, loadSettings, saveSettings, resetSettings } from './room/settings';

const MODEL = '/models/human.glb';
useGLTF.preload(MODEL);

const damp = (c, t, l, dt) => THREE.MathUtils.lerp(c, t, 1 - Math.exp(-l * dt));
const ringPos = (i, r) => {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / 6;
  return new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r);
};
const ringAngle = (i) => -Math.PI / 2 + (i * Math.PI * 2) / 6;

const TURN_MS = 4200;
const WALK_MS = 3000;

/* --------------------------------------------------------------- statuses */
function statusFor(id, live, act, shownTurns) {
  if (act && (act.a === id || act.b === id)) {
    const other = act.a === id ? act.bName : act.aName;
    if (act.phase === 'writing') return { icon: '✍️', text: 'writing the note up' };
    const last = shownTurns > 0 ? act.turns?.[shownTurns - 1] : null;
    if (last && last.agent === id) return { icon: '🗣️', text: `making the case to ${other}` };
    return { icon: '👂', text: `hearing ${other} out` };
  }
  const a = live?.agents?.[id];
  if (a?.busy) return { icon: '📊', text: 'running its checks' };
  const m = a?.metric || {};
  switch (id) {
    case 'trend':
      if (m.trendScore > 0.3) return { icon: '📈', text: 'holdings above their 200-day' };
      if (m.trendScore < -0.3) return { icon: '📉', text: `${m.downtrending?.length || 0} in a downtrend` };
      return { icon: '📐', text: 'trend is mixed' };
    case 'bear':
      if (m.high) return { icon: '🚨', text: `${m.high} serious flag${m.high > 1 ? 's' : ''}` };
      if (m.flags) return { icon: '⚠️', text: `${m.flags} rulebook flag${m.flags > 1 ? 's' : ''}` };
      return { icon: '🔍', text: 'nothing broken today' };
    case 'catalyst':
      if (m.freshNews) return { icon: '📰', text: `fresh news on ${m.tickers?.slice(0, 2).join(', ') || `${m.freshNews} names`}` };
      return { icon: '📭', text: 'no new catalysts' };
    case 'sector':
      if (m.hottest?.overCap) return { icon: '🌡️', text: `${m.hottest.name} ${Math.round(m.hottest.pct * 100)}% — over cap` };
      return { icon: '🌐', text: 'sectors within cap' };
    case 'sizing':
      if (m.tilt != null && Math.abs(m.tilt) > 0.5) return { icon: '⚖️', text: `Core ${Math.round((m.corePct || 0) * 100)}% vs 50% target` };
      return { icon: '⚖️', text: 'sleeves near target' };
    case 'quality':
      if (m.coreBroken?.length) return { icon: '🛡️', text: `watching ${m.coreBroken.join(', ')}` };
      return { icon: '🛡️', text: `${m.coreHeld || 0} Core names held` };
    default:
      return { icon: '💤', text: 'at the desk' };
  }
}

/* ------------------------------------------------------------------ human */
function Human({ color, walking, speakTick, scale }) {
  const group = useRef();
  const { scene, animations } = useGLTF(MODEL);
  const { model, head } = useMemo(() => {
    const c = cloneSkeleton(scene);
    const tint = new THREE.Color(color);
    c.traverse((o) => {
      if (!o.isMesh && !o.isSkinnedMesh) return;
      o.castShadow = true;
      o.frustumCulled = false;
      if (o.material?.name === 'VanguardBodyMat') {
        o.material = o.material.clone();
        o.material.color.copy(tint).multiplyScalar(0.85);
        o.material.roughness = 0.75;
      }
    });
    return { model: c, head: c.getObjectByName('mixamorig:Head') };
  }, [scene, color]);

  const { actions } = useAnimations(animations, group);
  useEffect(() => {
    const base = actions[walking ? 'Walk' : 'Idle'];
    if (!base) return;
    base.reset().fadeIn(0.3).play();
    return () => base.fadeOut(0.3);
  }, [actions, walking]);

  const gesture = useRef({ kind: null, t: 0 });
  useEffect(() => {
    if (speakTick) gesture.current = { kind: speakTick % 3 === 1 ? 'shake' : 'nod', t: 0 };
  }, [speakTick]);
  useFrame((_, dt) => {
    if (!head) return;
    const g = gesture.current;
    if (!g.kind) return;
    g.t += dt;
    const k = Math.min(1, g.t / 1.4);
    const w = Math.sin(g.t * 11) * 0.28 * (1 - k);
    if (g.kind === 'nod') head.rotation.x = w; else head.rotation.y = w;
    if (k >= 1) { head.rotation.x = 0; head.rotation.y = 0; g.kind = null; }
  });

  return <group ref={group} dispose={null}><primitive object={model} scale={scale} /></group>;
}

/* ------------------------------------------------------------------ agent */
function Agent({ agent, index, atTable, facing, speakTick, status, s, onSelect }) {
  const grp = useRef();
  const home = useMemo(() => ringPos(index, s.deskRing), [index, s.deskRing]);
  const seat = useMemo(() => ringPos(index, s.seatRing), [index, s.seatRing]);
  const homeAngle = useMemo(() => ringAngle(index) + Math.PI / 2, [index]);
  const target = atTable ? seat : home;
  const [walking, setWalking] = useState(false);

  useFrame((_, dt) => {
    const g = grp.current;
    if (!g) return;
    const dist = Math.hypot(target.x - g.position.x, target.z - g.position.z);
    setWalking(dist > 0.15);
    g.position.x = damp(g.position.x, target.x, 2.2, dt);
    g.position.z = damp(g.position.z, target.z, 2.2, dt);
    const want = dist > 0.15
      ? Math.atan2(target.x - g.position.x, target.z - g.position.z)
      : atTable ? Math.atan2(facing.x - g.position.x, facing.z - g.position.z) : homeAngle;
    let d = want - g.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    g.rotation.y += d * (1 - Math.exp(-6 * dt));
  });

  return (
    <group ref={grp} position={[home.x, 0, home.z]}>
      <mesh
        position={[0, 1, 0]}
        onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'default'; }}
      >
        <boxGeometry args={[0.9, 2, 0.9]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <Human color={agent.color} walking={walking} speakTick={speakTick} scale={s.agentScale} />
      {status && (
        <Html center position={[0, 2.15, 0]} zIndexRange={[20, 0]} style={{ pointerEvents: 'none' }}>
          <div
            className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5
                       bg-ink-950/85 border text-[10px] text-neutral-300 select-none"
            style={{ borderColor: agent.color + '55' }}
          >
            <span>{status.icon}</span><span>{status.text}</span>
          </div>
        </Html>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------- room */
function Room({ s, notes, active, onSelect }) {
  const W = s.roomSize, H = s.wallHeight;
  const glow = useRef();
  useFrame((st, dt) => {
    if (!glow.current) return;
    const want = active ? 1.6 + Math.sin(st.clock.elapsedTime * 2) * 0.25 : 0.18;
    glow.current.material.emissiveIntensity = damp(glow.current.material.emissiveIntensity, want, 3, dt);
  });

  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, W]} />
        <meshStandardMaterial color={s.floorColor} roughness={0.85} />
      </mesh>

      {s.showRug && (
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
          <circleGeometry args={[s.seatRing + 0.9, 56]} />
          <meshStandardMaterial color={s.rugColor} roughness={1} />
        </mesh>
      )}

      {/* inward-facing single-sided walls, so the near ones cull away */}
      {[[0, -W / 2, 0], [0, W / 2, Math.PI], [-W / 2, 0, Math.PI / 2], [W / 2, 0, -Math.PI / 2]].map(([x, z, ry], i) => (
        <mesh key={i} position={[x, H / 2, z]} rotation={[0, ry, 0]} receiveShadow>
          <planeGeometry args={[W, H]} />
          <meshStandardMaterial color={s.wallColor} roughness={0.95} side={THREE.FrontSide} />
        </mesh>
      ))}

      {s.showWindow && (
        <group position={[0, 0, -W / 2 + 0.06]}>
          <mesh position={[0, H * 0.6, 0]}>
            <planeGeometry args={[W * 0.42, H * 0.5]} />
            <meshStandardMaterial color="#0a1018" emissive="#16233a" emissiveIntensity={1.3} toneMapped={false} />
          </mesh>
          {Array.from({ length: 50 }).map((_, i) => (
            <mesh key={i} position={[((i * 37) % 40) / 10 - 2, H * 0.45 + ((i * 53) % 14) / 10, 0.01]}>
              <planeGeometry args={[0.05, 0.035]} />
              <meshBasicMaterial color={i % 4 ? '#ffd9a0' : '#9fc6ff'} />
            </mesh>
          ))}
        </group>
      )}

      {/* table */}
      <group
        onClick={(e) => { e.stopPropagation(); onSelect('table'); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'default'; }}
      >
        <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[s.tableRadius, s.tableRadius, 0.08, 48]} />
          <meshStandardMaterial color="#4a3524" roughness={0.55} />
        </mesh>
        <mesh ref={glow} position={[0, 0.783, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <ringGeometry args={[s.tableRadius - 0.16, s.tableRadius - 0.06, 48]} />
          <meshStandardMaterial color="#8ea2ff" emissive="#8ea2ff" emissiveIntensity={0.2} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.35, 0]}>
          <cylinderGeometry args={[0.26, 0.42, 0.72, 16]} />
          <meshStandardMaterial color="#2a2018" roughness={0.6} />
        </mesh>
        {notes.slice(0, 9).map((n, i) => {
          const a = (i / 9) * Math.PI * 2;
          const r = Math.max(0.2, s.tableRadius - 0.6);
          return (
            <mesh key={n.id || i} position={[Math.cos(a) * r, 0.79 + i * 0.003, Math.sin(a) * r]} rotation={[-Math.PI / 2, 0, -a]}>
              <planeGeometry args={[0.3, 0.21]} />
              <meshStandardMaterial
                color="#0e0e12"
                emissive={n.actionable ? '#facc15' : '#5b6784'}
                emissiveIntensity={n.actionable ? 0.9 : 0.28}
                toneMapped={false}
              />
            </mesh>
          );
        })}
      </group>

      {/* a desk per analyst */}
      {Array.from({ length: 6 }).map((_, i) => {
        const p = ringPos(i, s.deskRing);
        return (
          <group key={i} position={[p.x, 0, p.z]} rotation={[0, -ringAngle(i) + Math.PI / 2, 0]}>
            <RoundedBox args={[1.5, 0.08, 0.7]} radius={0.03} smoothness={3} position={[0, 0.74, -0.6]} castShadow receiveShadow>
              <meshStandardMaterial color="#2a2118" roughness={0.7} />
            </RoundedBox>
            {[[-0.65, -0.85], [0.65, -0.85], [-0.65, -0.35], [0.65, -0.35]].map(([x, z], k) => (
              <mesh key={k} position={[x, 0.37, z]}>
                <cylinderGeometry args={[0.03, 0.03, 0.74, 6]} />
                <meshStandardMaterial color="#1a1510" />
              </mesh>
            ))}
          </group>
        );
      })}

      {/* pendants over the table */}
      {[[-0.95, 0], [0.95, 0], [0, 0.95], [0, -0.95]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, H * 0.8, 0]}>
            <cylinderGeometry args={[0.008, 0.008, H * 0.4, 6]} />
            <meshStandardMaterial color="#2a2a32" />
          </mesh>
          <mesh position={[0, 2.2, 0]}>
            <sphereGeometry args={[0.065, 12, 12]} />
            <meshStandardMaterial color="#ffe6bd" emissive="#ffdca8" emissiveIntensity={2.6} toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  );
}

/* -------------------------------------------------------------------- rig */
function Rig({ s, mode, focusIndex }) {
  const { camera } = useThree();
  const tgt = useRef(new THREE.Vector3(0, 1, 0));
  const aim = useRef(new THREE.Vector3());
  const pos = useRef(new THREE.Vector3());
  const iso = useMemo(() => new THREE.Vector3(1, s.camHeight, 1).normalize(), [s.camHeight]);

  useFrame((st, dt) => {
    const t = st.clock.elapsedTime;
    let dist = s.camDistance, zoom = s.camZoom;
    if (mode === 'table') { aim.current.set(0, s.camTargetY, 0); dist = s.camDistance * 0.68; zoom = s.camZoom * 1.35; }
    else if (mode === 'agent' && focusIndex != null) {
      const p = ringPos(focusIndex, s.deskRing);
      aim.current.set(p.x * 0.8, s.camTargetY, p.z * 0.8);
      dist = s.camDistance * 0.55; zoom = s.camZoom * 1.7;
    } else aim.current.set(0, s.camTargetY, 0);

    pos.current.copy(aim.current).addScaledVector(iso, dist);
    pos.current.x += Math.sin(t * 0.13) * s.camDrift;
    pos.current.y += Math.sin(t * 0.1) * s.camDrift * 0.5;

    ['x', 'y', 'z'].forEach((k) => {
      camera.position[k] = damp(camera.position[k], pos.current[k], 2.6, dt);
      tgt.current[k] = damp(tgt.current[k], aim.current[k], 3, dt);
    });
    camera.lookAt(tgt.current);
    camera.zoom = damp(camera.zoom, zoom, 2.6, dt);
    camera.updateProjectionMatrix();
  });
  return null;
}

/* ------------------------------------------------------------------ scene */
function Scene({ agents, live, desk, notes, sel, setSel, s, shownTurns }) {
  const act = desk?.activeDialogue || null;
  const talking = act ? [act.a, act.b] : [];
  const lastSpeaker = shownTurns > 0 ? act?.turns?.[shownTurns - 1]?.agent : null;
  const idx = Object.fromEntries(agents.map((a, i) => [a.id, i]));
  const mode = act || sel === 'table' ? 'table' : sel ? 'agent' : 'wide';

  return (
    <>
      <color attach="background" args={[s.background]} />
      <fog attach="fog" args={[s.background, s.fogNear, s.fogFar]} />
      <ambientLight intensity={s.ambient} color={s.ambientColor} />
      <directionalLight
        position={[6, 10, 5]} intensity={s.keyIntensity} color={s.keyColor} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-10} shadow-camera-right={10}
        shadow-camera-top={10} shadow-camera-bottom={-10}
      />
      {[[-0.95, 0], [0.95, 0], [0, 0.95], [0, -0.95]].map(([x, z], i) => (
        <pointLight key={i} position={[x, 2.2, z]} distance={7} intensity={s.pendantIntensity} color={s.pendantColor} />
      ))}
      <pointLight position={[0, 2.2, -s.roomSize / 2 + 1]} distance={9} intensity={s.windowIntensity} color={s.windowColor} />

      <Room s={s} notes={notes} active={!!act} onSelect={setSel} />

      <Suspense fallback={null}>
        {agents.map((a, i) => {
          const atTable = talking.includes(a.id);
          const other = atTable ? talking.find((x) => x !== a.id) : null;
          return (
            <Agent
              key={a.id} agent={a} index={i} s={s}
              atTable={atTable}
              facing={other != null && idx[other] != null ? ringPos(idx[other], s.seatRing) : new THREE.Vector3()}
              speakTick={lastSpeaker === a.id ? shownTurns : 0}
              status={statusFor(a.id, live, act, shownTurns)}
              onSelect={setSel}
            />
          );
        })}
      </Suspense>

      <ContactShadows position={[0, 0.012, 0]} opacity={0.5} scale={16} blur={2} far={4} />
      <Rig s={s} mode={mode} focusIndex={sel && sel !== 'table' ? idx[sel] : null} />
      {s.bloom && (
        <EffectComposer disableNormalPass multisampling={0}>
          <Bloom mipmapBlur luminanceThreshold={s.bloomThreshold} intensity={s.bloomIntensity} radius={0.5} />
          <Vignette eskil={false} offset={0.3} darkness={s.vignette} />
          <SMAA />
        </EffectComposer>
      )}
    </>
  );
}

/* --------------------------------------------------------------- exported */
export default function TheRoom({ onAnalyze, onExit }) {
  const [floor, setFloor] = useState(null);
  const [desk, setDesk] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const [convening, setConvening] = useState(false);
  const [now, setNow] = useState(Date.now());
  const act = desk?.activeDialogue || null;

  const initial = useMemo(() => loadSettings(), []);

  // Everything you can turn. Changes apply live and persist.
  const s = useControls({
    Camera: folder({
      camDistance: { value: initial.camDistance, min: 6, max: 40, step: 0.5 },
      camHeight: { value: initial.camHeight, min: 0.3, max: 3, step: 0.05 },
      camZoom: { value: initial.camZoom, min: 20, max: 220, step: 1 },
      camTargetY: { value: initial.camTargetY, min: 0, max: 3, step: 0.05 },
      camDrift: { value: initial.camDrift, min: 0, max: 2, step: 0.05 },
    }, { collapsed: true }),
    Room: folder({
      roomSize: { value: initial.roomSize, min: 8, max: 30, step: 0.5 },
      wallHeight: { value: initial.wallHeight, min: 2, max: 8, step: 0.1 },
      floorColor: initial.floorColor,
      wallColor: initial.wallColor,
      rugColor: initial.rugColor,
      showRug: initial.showRug,
      showWindow: initial.showWindow,
    }, { collapsed: true }),
    Layout: folder({
      deskRing: { value: initial.deskRing, min: 2, max: 12, step: 0.1 },
      tableRadius: { value: initial.tableRadius, min: 0.6, max: 5, step: 0.1 },
      seatRing: { value: initial.seatRing, min: 1, max: 8, step: 0.1 },
      agentScale: { value: initial.agentScale, min: 0.3, max: 2, step: 0.05 },
    }, { collapsed: true }),
    Light: folder({
      ambient: { value: initial.ambient, min: 0, max: 3, step: 0.05 },
      ambientColor: initial.ambientColor,
      keyIntensity: { value: initial.keyIntensity, min: 0, max: 5, step: 0.05 },
      keyColor: initial.keyColor,
      pendantIntensity: { value: initial.pendantIntensity, min: 0, max: 30, step: 0.5 },
      pendantColor: initial.pendantColor,
      windowIntensity: { value: initial.windowIntensity, min: 0, max: 15, step: 0.1 },
      windowColor: initial.windowColor,
    }, { collapsed: true }),
    Atmosphere: folder({
      background: initial.background,
      fogNear: { value: initial.fogNear, min: 1, max: 60, step: 1 },
      fogFar: { value: initial.fogFar, min: 5, max: 120, step: 1 },
      bloom: initial.bloom,
      bloomIntensity: { value: initial.bloomIntensity, min: 0, max: 3, step: 0.05 },
      bloomThreshold: { value: initial.bloomThreshold, min: 0, max: 1, step: 0.01 },
      vignette: { value: initial.vignette, min: 0, max: 1.5, step: 0.02 },
    }, { collapsed: true }),
    'copy settings': button(() => {
      const json = JSON.stringify(latest.current, null, 2);
      navigator.clipboard?.writeText(json);
      // eslint-disable-next-line no-console
      console.log('[room settings]\n' + json);
      alert('Room settings copied to clipboard — paste them to Claude to bake in.');
    }),
    'reset to defaults': button(() => { resetSettings(); window.location.reload(); }),
  });

  const latest = useRef(s);
  useEffect(() => { latest.current = s; saveSettings(s); }, [s]);

  useEffect(() => {
    let alive = true;
    getFloor().then((f) => alive && setFloor(f)).catch((e) => alive && setErr(e.message));
    const tick = () => getDeskState().then((d) => alive && setDesk(d)).catch(() => {});
    tick();
    const id = setInterval(tick, act ? 1200 : 6000);
    return () => { alive = false; clearInterval(id); };
  }, [!!act]);

  useEffect(() => {
    if (!act) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [!!act]);

  const elapsed = act ? now - act.startedAt : 0;
  const shownTurns = act
    ? Math.max(0, Math.min(act.turns?.length || 0, Math.floor((elapsed - WALK_MS) / TURN_MS) + 1))
    : 0;

  const startConvene = async () => {
    setConvening(true);
    try { await convene(); } catch (e) { setErr(e.message); }
    finally { setConvening(false); getDeskState().then(setDesk).catch(() => {}); }
  };

  if (err && !floor) return <p className="p-4 text-xs text-red-400">{err}</p>;
  if (!floor) return <p className="p-4 text-xs text-haze animate-pulse">Opening the room…</p>;

  const notes = desk?.notes || [];
  const selAgent = sel && sel !== 'table' ? floor.agents.find((a) => a.id === sel) : null;

  return (
    <div className="fixed inset-0 top-[92px]" style={{ background: s.background }}>
      <Leva collapsed titleBar={{ title: 'Room controls' }} />

      <Canvas
        shadows dpr={[1, 1.8]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        orthographic
        camera={{ position: [18, 18, 18], zoom: s.camZoom, near: 0.1, far: 260 }}
        onPointerMissed={() => setSel(null)}
      >
        <Suspense fallback={null}>
          <Scene
            agents={floor.agents} live={floor.live} desk={desk} notes={notes}
            sel={sel} setSel={setSel} s={s} shownTurns={shownTurns}
          />
        </Suspense>
      </Canvas>

      <div className="absolute top-3 left-3 flex flex-col gap-1">
        {floor.agents.map((a) => (
          <button
            key={a.id}
            onClick={() => setSel(a.id)}
            className={`flex items-center gap-2 text-left text-[11px] font-mono tracking-wider pl-1.5 pr-2.5 py-1 rounded-md border transition-all ${
              sel === a.id ? 'bg-ink-850/90 border-ink-700 text-neutral-100'
                : 'bg-ink-950/60 border-transparent text-haze hover:text-neutral-300'
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: a.color }} />
            {a.name}
          </button>
        ))}
      </div>

      <div className="absolute top-3 right-[336px] flex items-center gap-2">
        <button
          onClick={startConvene}
          disabled={convening || !!act}
          className="text-[11px] px-2.5 py-1 rounded-md bg-indigo-500/85 text-white disabled:opacity-40"
        >
          {convening || act ? 'in session…' : 'convene the desk'}
        </button>
        <button onClick={onExit} className="text-[11px] text-haze hover:text-neutral-300 bg-ink-950/60 rounded-md px-2 py-1">
          cards view
        </button>
      </div>

      {act && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3 w-[min(92vw,640px)] card p-3 bg-ink-950/90 max-h-[38vh] overflow-y-auto">
          <p className="text-[10px] uppercase tracking-widest text-haze mb-1">{act.aName} × {act.bName} — at the table</p>
          <p className="text-[11px] text-neutral-300 mb-2">{act.topic}</p>
          {act.turns?.slice(0, shownTurns).map((t, i) => (
            <p key={i} className="text-[11px] text-neutral-400 mb-1">
              <span className="text-ink-500">{t.name}: </span>{t.text}
            </p>
          ))}
          {!shownTurns && <p className="text-[11px] text-haze animate-pulse">gathering their thoughts…</p>}
        </div>
      )}

      {sel === 'table' && !act && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3 w-[min(92vw,640px)] card p-3 bg-ink-950/90 max-h-[42vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-widest text-haze">Desk notes</p>
            <button onClick={() => setSel(null)} className="text-[11px] text-haze hover:text-neutral-300">close</button>
          </div>
          {!notes.length && <p className="text-[11px] text-haze">Nothing yet — hit “convene the desk”.</p>}
          {notes.map((n) => (
            <div key={n.id} className="mb-2.5">
              <p className="text-[10px] text-ink-500">
                {(n.participants || []).map((p) => floor.agents.find((a) => a.id === p)?.name || p).join(' × ')}
                {n.ticker ? ` · ${n.ticker}` : ''}{n.actionable && <span className="text-amber-400"> · actionable</span>}
              </p>
              <p className="text-[11px] text-neutral-300">{n.conclusion}</p>
            </div>
          ))}
        </div>
      )}

      {selAgent && !act && (
        <div className="absolute right-3 bottom-3 w-[min(92vw,380px)] card p-3 bg-ink-950/92 max-h-[62vh] overflow-y-auto space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs tracking-wider" style={{ color: selAgent.color }}>
              {selAgent.emoji} {selAgent.name}
            </span>
            <button onClick={() => setSel(null)} className="text-[11px] text-haze hover:text-neutral-300">close</button>
          </div>
          <AgentPanel agent={selAgent} data={floor.perAgent[selAgent.id]} onAnalyze={onAnalyze} />
          <AgentChat agent={selAgent} />
        </div>
      )}
    </div>
  );
}
