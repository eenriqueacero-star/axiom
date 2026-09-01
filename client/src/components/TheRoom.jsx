import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoundedBox, ContactShadows, useGLTF, useAnimations, Html } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import { getFloor, getDeskState, convene } from '../api';
import { AgentPanel, AgentChat } from './floor/shared';

const MODEL = '/models/human.glb';
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

// The human model ships Idle / Walk / Run. Agreement, disagreement and emphasis
// are driven procedurally on the head + spine, so no extra clips are needed.
const GESTURE = { yes: 'nod', thumbsup: 'nod', no: 'shake', punch: 'shake', dance: 'nod', wave: 'nod' };

// How long each spoken turn is held on screen, so a 5-second model exchange
// plays out at a watchable pace.
const TURN_MS = 4200;
const WALK_MS = 3000;

/**
 * What an agent is actually doing right now. Every branch is sourced from real
 * state — a cron job running, a live dialogue turn, or its own check on the
 * user's book. Nothing here is decorative.
 */
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
      if (m.trendScore < -0.3) return { icon: '📉', text: `${m.downtrending?.length || 0} names in a downtrend` };
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
    case 'sizing': {
      const t = m.tilt;
      if (t != null && Math.abs(t) > 0.5) {
        return { icon: '⚖️', text: `Core ${Math.round((m.corePct || 0) * 100)}% vs 50% target` };
      }
      return { icon: '⚖️', text: 'sleeves near target' };
    }
    case 'quality':
      if (m.coreBroken?.length) return { icon: '🛡️', text: `watching ${m.coreBroken.join(', ')}` };
      return { icon: '🛡️', text: `${m.coreHeld || 0} Core names held` };
    default:
      return { icon: '💤', text: 'at the desk' };
  }
}

function Bubble({ status, color }) {
  if (!status) return null;
  // NOTE: no distanceFactor — that scales by camera distance and assumes a
  // perspective camera. This scene is orthographic, where it blows the label up
  // to fill the screen. Screen-space size is what we want for a status label.
  return (
    <Html
      center
      position={[0, 2.35, 0]}
      zIndexRange={[20, 0]}
      style={{ pointerEvents: 'none' }}
    >
      <div
        className="flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5
                   bg-ink-950/85 border text-[10px] text-neutral-300 select-none backdrop-blur-sm"
        style={{ borderColor: color + '55' }}
      >
        <span>{status.icon}</span>
        <span>{status.text}</span>
      </div>
    </Html>
  );
}

/* ------------------------------------------------------------------- human */
function Human({ color, clipBase, reaction, speakTick }) {
  const group = useRef();
  const { scene, animations } = useGLTF(MODEL);

  const { model, head } = useMemo(() => {
    const c = cloneSkeleton(scene);
    const tint = new THREE.Color(color);
    c.traverse((o) => {
      if (o.isMesh || o.isSkinnedMesh) {
        o.castShadow = true;
        o.frustumCulled = false;
        // the outfit carries the agent's colour; the visor stays dark
        if (o.material?.name === 'VanguardBodyMat') {
          o.material = o.material.clone();
          o.material.color.copy(tint).multiplyScalar(0.85);
          o.material.metalness = 0.15;
          o.material.roughness = 0.75;
        } else if (o.material?.name === 'Vanguard_VisorMat') {
          o.material = o.material.clone();
          o.material.color.set('#15151a');
          o.material.emissive = tint.clone().multiplyScalar(0.35);
        }
      }
    });
    return { model: c, head: c.getObjectByName('mixamorig:Head') };
  }, [scene, color]);

  const { actions } = useAnimations(animations, group);

  useEffect(() => {
    const base = actions[clipBase];
    if (!base) return;
    base.reset().fadeIn(0.35).play();
    return () => base.fadeOut(0.35);
  }, [actions, clipBase]);

  // a gesture is a short burst on the head — nod for agreement, shake for
  // disagreement — layered on top of whatever clip is playing
  const gesture = useRef({ kind: null, t: 0 });
  useEffect(() => {
    const kind = GESTURE[reaction];
    if (kind) gesture.current = { kind, t: 0 };
  }, [reaction]);
  useEffect(() => {
    if (!speakTick) return;
    gesture.current = { kind: speakTick % 3 === 1 ? 'shake' : 'nod', t: 0 };
  }, [speakTick]);

  useFrame((s, dt) => {
    if (!head) return;
    const g = gesture.current;
    if (!g.kind) return;
    g.t += dt;
    const k = Math.min(1, g.t / 1.4);
    const decay = 1 - k;
    const w = Math.sin(g.t * 11) * 0.28 * decay;
    if (g.kind === 'nod') head.rotation.x += (w - head.rotation.x) * 0.5;
    else head.rotation.y += (w - head.rotation.y) * 0.5;
    if (k >= 1) { head.rotation.x = 0; head.rotation.y = 0; g.kind = null; }
  });

  return (
    <group ref={group} dispose={null}>
      <primitive object={model} scale={0.62} />
    </group>
  );
}

/* ------------------------------------------------- an agent + its movement */
function Agent({ agent, index, live, phase, facing, speakTick, focused, status, onSelect }) {
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
      <Human color={agent.color} clipBase={clipBase} reaction={reaction} speakTick={speakTick} />
      <Bubble status={status} color={agent.color} />
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
const W = 20, D = 20, H = 4.8;

function Plant({ position, scale = 1 }) {
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.24, 0.3, 0.44, 12]} />
        <meshStandardMaterial color="#6b5544" roughness={0.85} />
      </mesh>
      {[[0.1, 0.75, 0, 0.34], [-0.14, 0.66, 0.1, 0.28], [0.05, 0.6, -0.15, 0.24]].map(([x, y, z, r], i) => (
        <mesh key={i} position={[x, y, z]} rotation={[i * 0.5, i, i * 0.3]} castShadow>
          <icosahedronGeometry args={[r, 0]} />
          <meshStandardMaterial color={i % 2 ? '#2f6b42' : '#3a7d4e'} flatShading roughness={0.8} />
        </mesh>
      ))}
    </group>
  );
}

function Shelf({ position, rotation = [0, 0, 0] }) {
  return (
    <group position={position} rotation={rotation}>
      <mesh position={[0, 1.1, 0]} castShadow receiveShadow>
        <boxGeometry args={[2.4, 2.2, 0.34]} />
        <meshStandardMaterial color="#3a2e26" roughness={0.85} />
      </mesh>
      {[0.45, 1.05, 1.65].map((y) => (
        <group key={y}>
          <mesh position={[0, y, 0.02]}>
            <boxGeometry args={[2.24, 0.05, 0.32]} />
            <meshStandardMaterial color="#4a3a2e" roughness={0.8} />
          </mesh>
          {Array.from({ length: 9 }).map((_, i) => (
            <mesh key={i} position={[-0.98 + i * 0.24, y + 0.19, 0.04]} castShadow>
              <boxGeometry args={[0.14, 0.32 + ((i * 7) % 5) * 0.02, 0.24]} />
              <meshStandardMaterial
                color={new THREE.Color().setHSL(((i * 11) % 100) / 260 + 0.03, 0.3, 0.34)}
                roughness={0.8}
              />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

function Shell() {
  return (
    <group>
      {/* floor — warm boards, with a rug under the table */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color="#2a221c" roughness={0.9} metalness={0.05} />
      </mesh>
      {Array.from({ length: 14 }).map((_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, -D / 2 + i * 1.45]}>
          <planeGeometry args={[W, 0.02]} />
          <meshBasicMaterial color="#221b16" />
        </mesh>
      ))}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <circleGeometry args={[SEAT_R + 1.5, 48]} />
        <meshStandardMaterial color="#232a33" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.007, 0]}>
        <ringGeometry args={[SEAT_R + 1.28, SEAT_R + 1.4, 48]} />
        <meshBasicMaterial color="#39424f" />
      </mesh>

      {/* Walls face inward and are single-sided, so the two nearest the camera
          cull away and you can see into the room — dollhouse style. */}
      {[[0, -D / 2, 0], [0, D / 2, Math.PI], [-W / 2, 0, Math.PI / 2], [W / 2, 0, -Math.PI / 2]].map(([x, z, ry], i) => (
        <group key={i} position={[x, 0, z]} rotation={[0, ry, 0]}>
          <mesh position={[0, H / 2, 0]} receiveShadow>
            <planeGeometry args={[W, H]} />
            <meshStandardMaterial color="#191b21" roughness={0.95} side={THREE.FrontSide} />
          </mesh>
          <mesh position={[0, 1.05, 0.03]} receiveShadow>
            <planeGeometry args={[W, 2.1]} />
            <meshStandardMaterial color="#22262e" roughness={0.9} side={THREE.FrontSide} />
          </mesh>
          <mesh position={[0, 2.12, 0.06]}>
            <planeGeometry args={[W, 0.07]} />
            <meshBasicMaterial color="#3b4253" side={THREE.FrontSide} />
          </mesh>
        </group>
      ))}

      {/* a window wall — city at night, the only warm light from outside */}
      <group position={[0, 0, -D / 2 + 0.14]}>
        <mesh position={[0, 2.7, 0]}>
          <planeGeometry args={[8.4, 2.6]} />
          <meshStandardMaterial color="#0a1018" emissive="#16233a" emissiveIntensity={1.1} toneMapped={false} />
        </mesh>
        {Array.from({ length: 70 }).map((_, i) => {
          const x = ((i * 37) % 80) / 10 - 4;
          const y = 1.7 + ((i * 53) % 22) / 10;
          return (
            <mesh key={i} position={[x, y, 0.01]}>
              <planeGeometry args={[0.07, 0.05]} />
              <meshBasicMaterial color={i % 4 ? '#ffd9a0' : '#9fc6ff'} />
            </mesh>
          );
        })}
        {[-2.8, 0, 2.8].map((x) => (
          <mesh key={x} position={[x, 2.7, 0.03]}>
            <boxGeometry args={[0.08, 2.6, 0.06]} />
            <meshStandardMaterial color="#0f1116" roughness={0.7} />
          </mesh>
        ))}
      </group>

      {/* framed pieces on the other walls */}
      {[[-W / 2 + 0.2, 2.7, -4, Math.PI / 2], [-W / 2 + 0.2, 2.7, 2, Math.PI / 2],
        [W / 2 - 0.2, 2.7, -2, -Math.PI / 2], [0, 2.9, D / 2 - 0.2, Math.PI]].map(([x, y, z, ry], i) => (
        <group key={i} position={[x, y, z]} rotation={[0, ry, 0]}>
          <mesh castShadow>
            <boxGeometry args={[1.5, 1.05, 0.06]} />
            <meshStandardMaterial color="#4a3f33" roughness={0.7} />
          </mesh>
          <mesh position={[0, 0, 0.04]}>
            <planeGeometry args={[1.32, 0.88]} />
            <meshStandardMaterial
              color={['#26303f', '#2f2a3a', '#243328', '#3a2f2a'][i]}
              emissive={['#26303f', '#2f2a3a', '#243328', '#3a2f2a'][i]}
              emissiveIntensity={0.25}
              roughness={0.9}
            />
          </mesh>
        </group>
      ))}

      {/* credenza + coffee station on the back wall */}
      <group position={[6.2, 0, D / 2 - 1]}>
        <mesh position={[0, 0.45, 0]} castShadow receiveShadow>
          <boxGeometry args={[3.2, 0.9, 0.7]} />
          <meshStandardMaterial color="#3a2e26" roughness={0.85} />
        </mesh>
        <mesh position={[-0.9, 1.02, 0]} castShadow>
          <boxGeometry args={[0.4, 0.34, 0.3]} />
          <meshStandardMaterial color="#1a1a1f" roughness={0.6} metalness={0.3} />
        </mesh>
        {[-0.2, 0.1, 0.4].map((x) => (
          <mesh key={x} position={[x, 0.98, 0.1]} castShadow>
            <cylinderGeometry args={[0.07, 0.06, 0.16, 12]} />
            <meshStandardMaterial color="#d8d8dc" roughness={0.5} />
          </mesh>
        ))}
      </group>

      <Shelf position={[-7.4, 0, D / 2 - 0.9]} rotation={[0, Math.PI, 0]} />
      <Plant position={[-8.6, 0, -6.4]} scale={1.25} />
      <Plant position={[8.6, 0, 6.6]} scale={1.1} />
      <Plant position={[8.7, 0, -7]} scale={0.95} />

      {/* pendant lamps over the table */}
      <group position={[0, 0, 0]}>
        {[[-1.5, 0], [1.5, 0], [0, 1.5], [0, -1.5]].map(([x, z], i) => (
          <group key={i} position={[x, 0, z]}>
            <mesh position={[0, 3.55, 0]}>
              <cylinderGeometry args={[0.01, 0.01, 1.5, 6]} />
              <meshStandardMaterial color="#2a2a32" />
            </mesh>
            <mesh position={[0, 2.75, 0]} castShadow>
              <coneGeometry args={[0.3, 0.34, 16, 1, true]} />
              <meshStandardMaterial color="#20242c" roughness={0.6} metalness={0.4} side={THREE.DoubleSide} />
            </mesh>
            <mesh position={[0, 2.63, 0]}>
              <sphereGeometry args={[0.09, 12, 12]} />
              <meshStandardMaterial color="#ffe6bd" emissive="#ffdca8" emissiveIntensity={2.4} toneMapped={false} />
            </mesh>
          </group>
        ))}
      </group>

      {/* No ceiling — the camera looks in from above. A cornice line reads as
          the top of the room without blocking the view. */}
      {[[0, -D / 2, 0], [0, D / 2, Math.PI], [-W / 2, 0, Math.PI / 2], [W / 2, 0, -Math.PI / 2]].map(([x, z, ry], i) => (
        <mesh key={i} position={[x, H - 0.12, z]} rotation={[0, ry, 0]}>
          <planeGeometry args={[W, 0.12]} />
          <meshBasicMaterial color="#2c313d" side={THREE.FrontSide} />
        </mesh>
      ))}
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
function Scene({ agents, live, desk, notes, sel, setSel, shownTurns, phaseOf }) {
  const act = desk?.activeDialogue || null;
  const talking = act ? [act.a, act.b] : [];
  const lastSpeaker = shownTurns > 0 ? act?.turns?.[shownTurns - 1]?.agent : null;

  const idx = Object.fromEntries(agents.map((a, i) => [a.id, i]));
  const selIndex = sel && sel !== 'table' ? idx[sel] : null;
  const mode = act ? 'table' : sel === 'table' ? 'table' : sel ? 'station' : 'wide';

  return (
    <>
      <color attach="background" args={['#050507']} />
      <fog attach="fog" args={['#050507', 26, 62]} />
      <ambientLight intensity={0.42} color="#b9c2d8" />
      <directionalLight
        position={[9, 15, 7]} intensity={1.15} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-18} shadow-camera-right={18}
        shadow-camera-top={18} shadow-camera-bottom={-18}
      />
      {/* the rig over the table is the room's key practical light */}
      {/* the four pendants are the room's key light */}
      {[[-1.5,0],[1.5,0],[0,1.5],[0,-1.5]].map(([x,z],i)=>(
        <pointLight key={i} position={[x,2.6,z]} distance={11} intensity={act ? 9 : 5.5} color="#ffdcae" />
      ))}
      <pointLight position={[0,2.9,-9]} distance={14} intensity={2.4} color="#7ea6ff" />
      <directionalLight position={[-10, 6, -8]} intensity={0.25} color="#7c88ff" />

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
                phase={atTable ? phaseOf : 'station'}
                facing={other != null && idx[other] != null ? seatPos(idx[other]) : new THREE.Vector3(0, 0, 0)}
                speakTick={lastSpeaker === a.id ? shownTurns : 0}
                focused={sel === a.id}
                status={statusFor(a.id, live, act, shownTurns)}
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

  const [now, setNow] = useState(Date.now());
  const act = desk?.activeDialogue || null;

  useEffect(() => {
    let alive = true;
    getFloor().then((f) => alive && setFloor(f)).catch((e) => alive && setErr(e.message));
    const tick = () => getDeskState().then((d) => alive && setDesk(d)).catch(() => {});
    tick();
    // poll hard while something is happening at the table, gently otherwise
    let id = setInterval(tick, 5000);
    const retune = setInterval(() => {
      clearInterval(id);
      id = setInterval(tick, act ? 1200 : 5000);
    }, 3000);
    return () => { alive = false; clearInterval(id); clearInterval(retune); };
  }, [!!act]);

  // clock so the scene can pace the dialogue out over real seconds
  useEffect(() => {
    if (!act) return;
    const id = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(id);
  }, [!!act]);

  // The model answers in ~5s; play it back at a watchable pace instead.
  const elapsed = act ? now - act.startedAt : 0;
  const phaseOf = elapsed < WALK_MS ? 'toTable' : 'table';
  const shownTurns = act
    ? Math.max(0, Math.min(act.turns?.length || 0, Math.floor((elapsed - WALK_MS) / TURN_MS) + 1))
    : 0;

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
          <Scene agents={agents} live={floor.live} desk={desk} notes={notes} sel={sel} setSel={setSel}
            shownTurns={shownTurns} phaseOf={phaseOf} />
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
          {act.turns?.slice(0, shownTurns).map((t, i) => (
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
