import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoundedBox, ContactShadows, useGLTF, useAnimations } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import { getFloor, getDeskState, convene } from '../api';
import { AgentPanel, AgentChat } from './floor/shared';

const MODEL = '/models/robot.glb';
useGLTF.preload(MODEL);

/* ------------------------------------------------------------------ layout */
const STATION_R = 6.8;   // ring of workstations
const TABLE_R = 2.5;
const SEAT_R = 3.4;

// station i sits on a ring, facing the table
const stationPos = (i) => {
  const a = -Math.PI / 2 + (i * Math.PI * 2) / 6;
  return new THREE.Vector3(Math.cos(a) * STATION_R, 0, Math.sin(a) * STATION_R);
};
const stationAngle = (i) => -Math.PI / 2 + (i * Math.PI * 2) / 6;
// where an agent stands when called to the table
const seatPos = (i) => {
  const a = stationAngle(i);
  return new THREE.Vector3(Math.cos(a) * SEAT_R, 0, Math.sin(a) * SEAT_R);
};

const ISO = new THREE.Vector3(1, 1.02, 1).normalize();
const damp = (c, t, l, dt) => THREE.MathUtils.lerp(c, t, 1 - Math.exp(-l * dt));

// reaction cue -> RobotExpressive clip
const CLIP = {
  idle: 'Idle', wave: 'Wave', yes: 'Yes', no: 'No',
  thumbsup: 'ThumbsUp', dance: 'Dance', punch: 'Punch', walking: 'Walking',
};
const ONESHOT = new Set(['Wave', 'Yes', 'No', 'ThumbsUp', 'Punch']);
// gestures an agent makes while it's the one speaking at the table
const SPEAK_GESTURES = ['Yes', 'No', 'ThumbsUp', 'Wave'];

/* ------------------------------------------------------------------- robot */
function Robot({ color, clipBase, reaction, speakTick }) {
  const group = useRef();
  const { scene, animations } = useGLTF(MODEL);
  const model = useMemo(() => {
    const c = cloneSkeleton(scene);
    const tint = new THREE.Color(color);
    c.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (o.material?.name === 'Main') {
        o.material = o.material.clone();
        o.material.color.copy(tint);
        o.material.emissive = tint.clone().multiplyScalar(0.1);
        o.material.metalness = 0.25;
        o.material.roughness = 0.5;
      }
    });
    return c;
  }, [scene, color]);

  const { actions, mixer } = useAnimations(animations, group);

  // base loop — Idle at the desk, Walking while crossing the room
  useEffect(() => {
    const base = actions[clipBase];
    if (!base) return;
    base.reset().fadeIn(0.3).play();
    return () => base.fadeOut(0.3);
  }, [actions, clipBase]);

  // one-shot over the base: either a live state cue, or a gesture per spoken turn
  const play = (clip) => {
    const a = actions[clip];
    if (!a) return () => {};
    const oneShot = ONESHOT.has(clip);
    a.reset();
    a.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = true;
    a.setEffectiveWeight(1).fadeIn(0.2).play();
    let timer;
    const onFinish = (e) => { if (e.action === a) a.fadeOut(0.4); };
    if (oneShot) mixer.addEventListener('finished', onFinish);
    else timer = setTimeout(() => a.fadeOut(0.5), 3000);
    return () => { mixer.removeEventListener('finished', onFinish); clearTimeout(timer); a.fadeOut(0.2); };
  };

  useEffect(() => {
    const clip = CLIP[reaction];
    if (!clip || clip === 'Idle' || clip === 'Walking') return;
    return play(clip);
  }, [actions, mixer, reaction]);

  // each spoken turn at the table = one gesture
  useEffect(() => {
    if (!speakTick) return;
    return play(SPEAK_GESTURES[speakTick % SPEAK_GESTURES.length]);
  }, [actions, mixer, speakTick]);

  return (
    <group ref={group} dispose={null}>
      <primitive object={model} scale={0.42} />
    </group>
  );
}

/* ------------------------------------------------- an agent + its movement */
function Agent({ agent, index, live, phase, facing, speakTick, focused, onSelect }) {
  const grp = useRef();
  const home = useMemo(() => stationPos(index), [index]);
  const seat = useMemo(() => seatPos(index), [index]);
  const homeAngle = useMemo(() => stationAngle(index) + Math.PI / 2, [index]);

  const target = phase === 'table' || phase === 'toTable' ? seat : home;
  const walking = phase === 'toTable' || phase === 'toStation';

  useFrame((s, dt) => {
    const g = grp.current;
    if (!g) return;
    // walk toward wherever this agent is meant to be
    g.position.x = damp(g.position.x, target.x, walking ? 2.2 : 6, dt);
    g.position.z = damp(g.position.z, target.z, walking ? 2.2 : 6, dt);

    let want;
    if (walking) {
      // face the direction of travel
      want = Math.atan2(target.x - g.position.x, target.z - g.position.z);
    } else if (phase === 'table') {
      want = Math.atan2(facing.x - g.position.x, facing.z - g.position.z);
    } else {
      want = homeAngle; // at the desk, facing the room
    }
    let d = want - g.rotation.y;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    g.rotation.y += d * (1 - Math.exp(-6 * dt));
  });

  const clipBase = walking ? 'Walking' : 'Idle';
  const reaction = phase === 'station' ? (live?.reaction || 'idle') : 'idle';

  return (
    <group ref={grp} position={[home.x, 0, home.z]}>
      <mesh
        position={[0, 1, 0]}
        onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'default'; }}
      >
        <boxGeometry args={[1.4, 2.2, 1.4]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>
      <Robot color={agent.color} clipBase={clipBase} reaction={reaction} speakTick={speakTick} />
      <pointLight position={[0, 2.2, 0.6]} distance={4.5} intensity={focused ? 2.2 : 0.5} color={agent.color} />
    </group>
  );
}

/* ------------------------------------------------------------ workstation */
function Station({ agent, index, focused, unread, onSelect }) {
  const p = useMemo(() => stationPos(index), [index]);
  const a = useMemo(() => stationAngle(index), [index]);
  const screen = useRef();
  const c = useMemo(() => new THREE.Color(agent.color), [agent.color]);

  useFrame((s, dt) => {
    if (!screen.current) return;
    // screen brightness = how many of this agent's calls you haven't opened
    const want = focused ? 1.5 : 0.3 + Math.min(unread, 6) * 0.14;
    screen.current.material.emissiveIntensity = damp(screen.current.material.emissiveIntensity, want, 4, dt);
  });

  return (
    <group position={[p.x, 0, p.z]} rotation={[0, -a + Math.PI / 2, 0]}
      onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}
    >
      {/* desk */}
      <RoundedBox args={[2.6, 0.12, 1.1]} radius={0.05} smoothness={3} position={[0, 0.78, -0.75]} castShadow receiveShadow>
        <meshStandardMaterial color="#1c1c21" metalness={0.3} roughness={0.6} />
      </RoundedBox>
      {[[-1.1, -1.15], [1.1, -1.15], [-1.1, -0.35], [1.1, -0.35]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.39, z]}>
          <cylinderGeometry args={[0.05, 0.05, 0.78, 8]} />
          <meshStandardMaterial color="#141418" metalness={0.4} roughness={0.5} />
        </mesh>
      ))}
      {/* monitor — a screen, not a slab of colour */}
      <mesh position={[0, 1.22, -1.1]} rotation={[-0.12, 0, 0]}>
        <boxGeometry args={[1.06, 0.64, 0.05]} />
        <meshStandardMaterial color="#0a0a0c" metalness={0.4} roughness={0.4} />
      </mesh>
      <mesh ref={screen} position={[0, 1.22, -1.07]} rotation={[-0.12, 0, 0]}>
        <planeGeometry args={[0.96, 0.55]} />
        <meshStandardMaterial color="#0a0a0e" emissive={c} emissiveIntensity={0.35} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.92, -1.1]}>
        <boxGeometry args={[0.1, 0.36, 0.1]} />
        <meshStandardMaterial color="#141418" metalness={0.4} />
      </mesh>
      {/* name strip on the desk edge */}
      <mesh position={[0, 0.73, -0.22]}>
        <boxGeometry args={[2.3, 0.02, 0.05]} />
        <meshStandardMaterial color={c} emissive={c} emissiveIntensity={focused ? 2 : 0.6} toneMapped={false} />
      </mesh>
      {/* chair */}
      <group position={[0, 0, 0.35]}>
        <RoundedBox args={[0.7, 0.1, 0.7]} radius={0.05} smoothness={3} position={[0, 0.5, 0]} castShadow>
          <meshStandardMaterial color="#17171c" roughness={0.8} />
        </RoundedBox>
        <RoundedBox args={[0.7, 0.7, 0.1]} radius={0.05} smoothness={3} position={[0, 0.85, 0.32]} castShadow>
          <meshStandardMaterial color="#17171c" roughness={0.8} />
        </RoundedBox>
        <mesh position={[0, 0.25, 0]}><cylinderGeometry args={[0.06, 0.06, 0.5, 8]} /><meshStandardMaterial color="#101014" metalness={0.5} /></mesh>
      </group>
    </group>
  );
}

/* ----------------------------------------------------------------- table */
function Table({ notes, active, onSelect }) {
  const glow = useRef();
  useFrame((s, dt) => {
    if (!glow.current) return;
    // the table only lights up when a conversation is actually happening
    const want = active ? 1.6 + Math.sin(s.clock.elapsedTime * 2) * 0.25 : 0.18;
    glow.current.material.emissiveIntensity = damp(glow.current.material.emissiveIntensity, want, 3, dt);
  });

  return (
    <group
      onClick={(e) => { e.stopPropagation(); onSelect('table'); }}
      onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { document.body.style.cursor = 'default'; }}
    >
      <mesh position={[0, 0.72, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TABLE_R, TABLE_R, 0.12, 48]} />
        <meshStandardMaterial color="#1b1b21" metalness={0.35} roughness={0.5} />
      </mesh>
      <mesh ref={glow} position={[0, 0.786, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[TABLE_R - 0.22, TABLE_R - 0.08, 48]} />
        <meshStandardMaterial color="#8ea2ff" emissive="#8ea2ff" emissiveIntensity={0.2} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.4, 0.6, 0.7, 16]} />
        <meshStandardMaterial color="#131317" metalness={0.4} roughness={0.5} />
      </mesh>

      {/* one card per desk note the council has produced */}
      {notes.slice(0, 9).map((n, i) => {
        const a = (i / 9) * Math.PI * 2;
        const r = TABLE_R - 0.85;
        return (
          <mesh key={n.id || i} position={[Math.cos(a) * r, 0.8 + i * 0.004, Math.sin(a) * r]} rotation={[-Math.PI / 2, 0, -a]}>
            <planeGeometry args={[0.62, 0.42]} />
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
  );
}

/* ------------------------------------------------------------------ room */
function Shell() {
  const W = 20, D = 20, H = 4.6;
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color="#101014" metalness={0.15} roughness={0.85} />
      </mesh>
      {/* subtle floor ring marking the walk between desks and the table */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.006, 0]}>
        <ringGeometry args={[SEAT_R + 0.6, SEAT_R + 0.68, 64]} />
        <meshBasicMaterial color="#2a2a34" />
      </mesh>
      {[[0, -D / 2], [0, D / 2], [-W / 2, 0], [W / 2, 0]].map(([x, z], i) => (
        <mesh key={i} position={[x, H / 2, z]} rotation={[0, i < 2 ? 0 : Math.PI / 2, 0]} receiveShadow>
          <boxGeometry args={[i < 2 ? W : D, H, 0.15]} />
          <meshStandardMaterial color="#0b0b0f" roughness={0.95} side={THREE.DoubleSide} />
        </mesh>
      ))}
      {/* ceiling rig over the table — a thin ring fixture, not a slab of light */}
      <group position={[0, 4.3, 0]}>
        <mesh>
          <torusGeometry args={[1.9, 0.05, 8, 48]} />
          <meshStandardMaterial color="#cfd6ff" emissive="#cfd6ff" emissiveIntensity={0.9} toneMapped={false} />
        </mesh>
        {[0, 1, 2].map((i) => {
          const a = (i / 3) * Math.PI * 2;
          return (
            <mesh key={i} position={[Math.cos(a) * 1.9, 0.35, Math.sin(a) * 1.9]}>
              <cylinderGeometry args={[0.012, 0.012, 0.7, 6]} />
              <meshStandardMaterial color="#2a2a32" />
            </mesh>
          );
        })}
      </group>
    </group>
  );
}

/* -------------------------------------------------------------------- rig */
function Rig({ mode, focusIndex }) {
  const { camera } = useThree();
  const tgt = useRef(new THREE.Vector3(0, 1, 0));
  const aim = useRef(new THREE.Vector3());
  const pos = useRef(new THREE.Vector3());

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime;
    let dist = 26, zoom = 54;
    if (mode === 'table') { aim.current.set(0, 1.1, 0); dist = 16; zoom = 76; }
    else if (mode === 'station' && focusIndex != null) {
      const p = stationPos(focusIndex);
      aim.current.set(p.x * 0.82, 1.1, p.z * 0.82); dist = 13; zoom = 92;
    } else { aim.current.set(0, 1, 0); }

    pos.current.copy(aim.current).addScaledVector(ISO, dist);
    pos.current.x += Math.sin(t * 0.13) * 0.4;
    pos.current.y += Math.sin(t * 0.1) * 0.2;

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

/* ----------------------------------------------------------------- scene */
function Scene({ agents, live, desk, notes, sel, setSel }) {
  const act = desk?.activeDialogue || null;
  const talking = act ? [act.a, act.b] : [];
  const turnCount = act?.turns?.length || 0;
  const lastSpeaker = turnCount ? act.turns[turnCount - 1].agent : null;

  const idx = Object.fromEntries(agents.map((a, i) => [a.id, i]));
  const selIndex = sel && sel !== 'table' ? idx[sel] : null;
  const mode = act ? 'table' : sel === 'table' ? 'table' : sel ? 'station' : 'wide';

  return (
    <>
      <color attach="background" args={['#050507']} />
      <fog attach="fog" args={['#050507', 26, 62]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[9, 15, 7]} intensity={1.15} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-18} shadow-camera-right={18}
        shadow-camera-top={18} shadow-camera-bottom={-18}
      />
      {/* the rig over the table is the room's key practical light */}
      <pointLight position={[0, 4, 0]} distance={16} intensity={act ? 26 : 12} color="#cfd6ff" />
      <directionalLight position={[-10, 6, -8]} intensity={0.3} color="#7c88ff" />

      <Shell />
      <Table notes={notes} active={!!act} onSelect={setSel} />

      <Suspense fallback={null}>
        {agents.map((a, i) => {
          const atTable = talking.includes(a.id);
          const other = atTable ? talking.find((x) => x !== a.id) : null;
          return (
            <group key={a.id}>
              <Station
                agent={a} index={i}
                focused={sel === a.id}
                unread={live?.agents?.[a.id]?.metric?.freshNews || 0}
                onSelect={setSel}
              />
              <Agent
                agent={a} index={i}
                live={live?.agents?.[a.id]}
                phase={atTable ? 'table' : 'station'}
                facing={other != null && idx[other] != null ? seatPos(idx[other]) : new THREE.Vector3(0, 0, 0)}
                speakTick={lastSpeaker === a.id ? turnCount : 0}
                focused={sel === a.id}
                onSelect={setSel}
              />
            </group>
          );
        })}
      </Suspense>

      <ContactShadows position={[0, 0.01, 0]} opacity={0.45} scale={30} blur={2.4} far={6} />
      <Rig mode={mode} focusIndex={selIndex} />
      <EffectComposer disableNormalPass multisampling={0}>
        <Bloom mipmapBlur luminanceThreshold={0.72} luminanceSmoothing={0.25} intensity={0.45} radius={0.5} />
        <Vignette eskil={false} offset={0.3} darkness={0.66} />
        <SMAA />
      </EffectComposer>
    </>
  );
}

/* -------------------------------------------------------------- exported */
export default function TheRoom({ onAnalyze, onExit }) {
  const [floor, setFloor] = useState(null);
  const [desk, setDesk] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);
  const [convening, setConvening] = useState(false);

  useEffect(() => {
    let alive = true;
    getFloor().then((f) => alive && setFloor(f)).catch((e) => alive && setErr(e.message));
    const tick = () => getDeskState().then((d) => alive && setDesk(d)).catch(() => {});
    tick();
    const id = setInterval(tick, 5000);
    return () => { alive = false; clearInterval(id); };
  }, []);

  const startConvene = async () => {
    setConvening(true);
    try { await convene(); } catch (e) { setErr(e.message); }
    finally {
      setConvening(false);
      getDeskState().then(setDesk).catch(() => {});
    }
  };

  if (err && !floor) return <p className="p-4 text-xs text-red-400">{err}</p>;
  if (!floor) return <p className="p-4 text-xs text-haze animate-pulse">Opening the room…</p>;

  const agents = floor.agents;
  const notes = desk?.notes || [];
  const act = desk?.activeDialogue || null;
  const selAgent = sel && sel !== 'table' ? agents.find((a) => a.id === sel) : null;

  return (
    <div className="fixed inset-0 top-[92px] bg-[#050507]">
      <Canvas
        shadows
        dpr={[1, 1.8]}
        gl={{ antialias: false, powerPreference: 'high-performance' }}
        orthographic
        camera={{ position: [30, 30, 30], zoom: 42, near: 0.1, far: 260 }}
        onPointerMissed={() => setSel(null)}
      >
        <Suspense fallback={null}>
          <Scene agents={agents} live={floor.live} desk={desk} notes={notes} sel={sel} setSel={setSel} />
        </Suspense>
      </Canvas>

      {/* agent list */}
      <div className="absolute top-3 left-3 flex flex-col gap-1">
        {agents.map((a) => {
          const busy = floor.live?.agents?.[a.id]?.busy;
          const atTable = act && (act.a === a.id || act.b === a.id);
          return (
            <button
              key={a.id}
              onClick={() => setSel(a.id)}
              className={`flex items-center gap-2 text-left text-[11px] font-mono tracking-wider pl-1.5 pr-2.5 py-1 rounded-md border transition-all ${
                sel === a.id ? 'bg-ink-850/90 border-ink-700 text-neutral-100'
                  : 'bg-ink-950/60 border-transparent text-haze hover:text-neutral-300'
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full shrink-0"
                style={{ background: a.color, boxShadow: sel === a.id ? `0 0 8px ${a.color}` : 'none' }} />
              {a.name}
              {atTable && <span className="text-[9px] text-indigo-300">at the table</span>}
              {!atTable && busy && <span className="text-[9px] text-emerald-400 animate-pulse">●</span>}
            </button>
          );
        })}
      </div>

      <div className="absolute top-3 right-3 flex items-center gap-2">
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

      {/* live transcript while two agents are talking */}
      {act && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3 w-[min(92vw,640px)] card p-3 bg-ink-950/90 max-h-[38vh] overflow-y-auto">
          <p className="text-[10px] uppercase tracking-widest text-haze mb-1">
            {act.aName} × {act.bName} — at the table
          </p>
          <p className="text-[11px] text-neutral-300 mb-2">{act.topic}</p>
          {act.turns?.map((t, i) => (
            <p key={i} className="text-[11px] text-neutral-400 mb-1">
              <span className="text-ink-500">{t.name}: </span>{t.text}
            </p>
          ))}
          {!act.turns?.length && <p className="text-[11px] text-haze animate-pulse">gathering their thoughts…</p>}
        </div>
      )}

      {/* desk notes */}
      {sel === 'table' && !act && (
        <div className="absolute left-1/2 -translate-x-1/2 bottom-3 w-[min(92vw,640px)] card p-3 bg-ink-950/90 max-h-[42vh] overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] uppercase tracking-widest text-haze">
              Desk notes — what the council has settled
            </p>
            <button onClick={() => setSel(null)} className="text-[11px] text-haze hover:text-neutral-300">close</button>
          </div>
          {!notes.length && (
            <p className="text-[11px] text-haze">
              Nothing yet. They'll talk on their own when you're away, or hit “convene the desk”.
            </p>
          )}
          {notes.map((n) => (
            <div key={n.id} className="mb-2.5">
              <p className="text-[10px] text-ink-500">
                {(n.participants || []).map((p) => agents.find((a) => a.id === p)?.name || p).join(' × ')}
                {n.ticker ? ` · ${n.ticker}` : ''}
                {n.actionable && <span className="text-amber-400"> · actionable</span>}
              </p>
              <p className="text-[11px] text-neutral-300">{n.conclusion}</p>
              {n.keyPoints?.length > 0 && (
                <ul className="mt-0.5">
                  {n.keyPoints.map((k, i) => (
                    <li key={i} className="text-[10px] text-haze">· {k}</li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      )}

      {/* an agent's own panel + chat */}
      {selAgent && !act && (
        <div className="absolute right-3 bottom-3 w-[min(92vw,380px)] card p-3 bg-ink-950/92 max-h-[62vh] overflow-y-auto space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs tracking-wider" style={{ color: selAgent.color }}>
              {selAgent.emoji} {selAgent.name}
            </span>
            <button onClick={() => setSel(null)} className="text-[11px] text-haze hover:text-neutral-300">close</button>
          </div>
          <p className="text-[11px] uppercase tracking-wide text-haze">{selAgent.role}</p>
          <AgentPanel agent={selAgent} data={floor.perAgent[selAgent.id]} onAnalyze={onAnalyze} />
          <AgentChat agent={selAgent} />
        </div>
      )}
    </div>
  );
}
