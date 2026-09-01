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

/* CC0 furniture from Poly Haven, fetched by scripts/fetch-room-assets.mjs.
   Real-world metre scale, Y-up, origin on the floor — so they drop straight in
   at scale 1 next to a 1.83 m person. Draco-compressed; decoder is self-hosted
   in /draco so there's no CDN dependency at runtime. */
const F = {
  desk:      '/models/room/WoodenTable_03.glb',
  chair:     '/models/room/ArmChair_01.glb',
  shelf:     '/models/room/wooden_bookshelf_worn.glb',
  books:     '/models/room/book_encyclopedia_set_01.glb',
  sofa:      '/models/room/Sofa_01.glb',
  coffee:    '/models/room/CoffeeTable_01.glb',
  plant:     '/models/room/calathea_orbifolia_01.glb',
  laptop:    '/models/room/classic_laptop.glb',
  clock:     '/models/room/vintage_grandfather_clock_01.glb',
};
Object.values(F).forEach((u) => useGLTF.preload(u, '/draco/'));

/** One piece of furniture. Cloned so the same GLB can appear many times. */
function Prop({ url, position = [0, 0, 0], rotation = [0, 0, 0], scale = 1 }) {
  const { scene } = useGLTF(url, '/draco/');
  const obj = useMemo(() => {
    const c = scene.clone(true);
    c.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return c;
  }, [scene]);
  return <primitive object={obj} position={position} rotation={rotation} scale={scale} />;
}

/* ------------------------------------------------------------------ layout */
// Metres. A 13 m room reads as a real council chamber; 20 m was a warehouse.
const STATION_R = 4.6;   // ring of desks
const TABLE_R = 1.6;
const SEAT_R = 2.35;

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
      position={[0, 2.15, 0]}
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
      <primitive object={model} scale={0.95} />
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
        <boxGeometry args={[0.9, 2.0, 0.9]} />
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
  const lamp = useRef();
  const c = useMemo(() => new THREE.Color(agent.color), [agent.color]);

  useFrame((s2, dt) => {
    if (!lamp.current) return;
    // desk lamp brightness = this agent's unread calls
    const want = focused ? 3.2 : 0.5 + Math.min(unread, 6) * 0.35;
    lamp.current.intensity = damp(lamp.current.intensity, want, 4, dt);
  });

  return (
    <group position={[p.x, 0, p.z]} rotation={[0, -a + Math.PI / 2, 0]}
      onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}
    >
      <Prop url={F.desk} position={[0, 0, -0.6]} rotation={[0, Math.PI, 0]} />
      <Prop url={F.laptop} position={[0, 0.83, -0.62]} rotation={[0, Math.PI, 0]} scale={0.9} />
      {/* a small colour plate on the desk edge is the only non-physical cue */}
      <mesh position={[0, 0.845, -0.3]}>
        <boxGeometry args={[0.5, 0.012, 0.04]} />
        <meshStandardMaterial color={c} emissive={c} emissiveIntensity={focused ? 2.4 : 0.7} toneMapped={false} />
      </mesh>
      <pointLight ref={lamp} position={[0.45, 1.25, -0.5]} distance={3} intensity={0.6} color="#ffd9a8" />
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
      <mesh position={[0, 0.74, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TABLE_R, TABLE_R, 0.08, 48]} />
        <meshStandardMaterial color="#4a3524" metalness={0.1} roughness={0.55} />
      </mesh>
      <mesh ref={glow} position={[0, 0.783, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[TABLE_R - 0.16, TABLE_R - 0.06, 48]} />
        <meshStandardMaterial color="#8ea2ff" emissive="#8ea2ff" emissiveIntensity={0.2} toneMapped={false} />
      </mesh>
      <mesh position={[0, 0.35, 0]}>
        <cylinderGeometry args={[0.26, 0.42, 0.72, 16]} />
        <meshStandardMaterial color="#131317" metalness={0.4} roughness={0.5} />
      </mesh>

      {/* one card per desk note the council has produced */}
      {notes.slice(0, 9).map((n, i) => {
        const a = (i / 9) * Math.PI * 2;
        const r = TABLE_R - 0.6;
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
  );
}

/* ------------------------------------------------------------------ room */
const W = 13, D = 13, H = 3.6;

function Shell() {
  return (
    <group>
      {/* boards */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[W, D]} />
        <meshStandardMaterial color="#3a2c22" roughness={0.85} metalness={0.03} />
      </mesh>
      {Array.from({ length: 18 }).map((_, i) => (
        <mesh key={i} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.002, -D / 2 + i * 0.75]}>
          <planeGeometry args={[W, 0.015]} />
          <meshBasicMaterial color="#2c211a" />
        </mesh>
      ))}
      {/* rug under the table */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]} receiveShadow>
        <circleGeometry args={[3.1, 56]} />
        <meshStandardMaterial color="#2b3440" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.007, 0]}>
        <ringGeometry args={[2.9, 3.0, 56]} />
        <meshBasicMaterial color="#41505f" />
      </mesh>

      {/* walls face inward and are single-sided, so the near ones cull away */}
      {[[0, -D / 2, 0], [0, D / 2, Math.PI], [-W / 2, 0, Math.PI / 2], [W / 2, 0, -Math.PI / 2]].map(([x, z, ry], i) => (
        <group key={i} position={[x, 0, z]} rotation={[0, ry, 0]}>
          <mesh position={[0, H / 2, 0]} receiveShadow>
            <planeGeometry args={[W, H]} />
            <meshStandardMaterial color="#232028" roughness={0.95} side={THREE.FrontSide} />
          </mesh>
          <mesh position={[0, 0.85, 0.02]} receiveShadow>
            <planeGeometry args={[W, 1.7]} />
            <meshStandardMaterial color="#33291f" roughness={0.9} side={THREE.FrontSide} />
          </mesh>
          <mesh position={[0, 1.72, 0.04]}>
            <planeGeometry args={[W, 0.06]} />
            <meshBasicMaterial color="#4d3f2e" side={THREE.FrontSide} />
          </mesh>
          <mesh position={[0, H - 0.08, 0.04]}>
            <planeGeometry args={[W, 0.08]} />
            <meshBasicMaterial color="#4d3f2e" side={THREE.FrontSide} />
          </mesh>
        </group>
      ))}

      {/* window onto the city — the only cool light in the room */}
      <group position={[0, 0, -D / 2 + 0.06]}>
        <mesh position={[0, 2.1, 0]}>
          <planeGeometry args={[5.4, 1.9]} />
          <meshStandardMaterial color="#0a1018" emissive="#16233a" emissiveIntensity={1.3} toneMapped={false} />
        </mesh>
        {Array.from({ length: 60 }).map((_, i) => (
          <mesh key={i} position={[((i * 37) % 52) / 10 - 2.6, 1.35 + ((i * 53) % 16) / 10, 0.01]}>
            <planeGeometry args={[0.05, 0.035]} />
            <meshBasicMaterial color={i % 4 ? '#ffd9a0' : '#9fc6ff'} />
          </mesh>
        ))}
        {[-1.8, 0, 1.8].map((x) => (
          <mesh key={x} position={[x, 2.1, 0.02]}>
            <boxGeometry args={[0.06, 1.9, 0.05]} />
            <meshStandardMaterial color="#161318" roughness={0.7} />
          </mesh>
        ))}
      </group>

      {/* the furniture — all CC0 Poly Haven, real metre scale */}
      <Prop url={F.shelf} position={[-4.6, 0, -D / 2 + 0.35]} />
      <Prop url={F.shelf} position={[-3.1, 0, -D / 2 + 0.35]} />
      <Prop url={F.books} position={[-4.9, 1.02, -D / 2 + 0.3]} rotation={[0, 0.2, 0]} />
      <Prop url={F.books} position={[-3.4, 1.46, -D / 2 + 0.3]} rotation={[0, -0.1, 0]} />
      <Prop url={F.clock} position={[W / 2 - 0.5, 0, -D / 2 + 0.6]} rotation={[0, -Math.PI / 4, 0]} />

      {/* lounge corner */}
      <Prop url={F.sofa} position={[-4.4, 0, 4.5]} rotation={[0, Math.PI / 2 + 0.35, 0]} />
      <Prop url={F.coffee} position={[-3.0, 0, 4.9]} rotation={[0, 0.3, 0]} />

      <Prop url={F.plant} position={[4.7, 0, 4.6]} rotation={[0, 0.6, 0]} scale={0.75} />
      <Prop url={F.plant} position={[-5.4, 0, -1.2]} rotation={[0, -1.1, 0]} scale={0.6} />

      {/* six armchairs around the table, one per analyst */}
      {Array.from({ length: 6 }).map((_, i) => {
        const a = stationAngle(i);
        return (
          <Prop
            key={i}
            url={F.chair}
            position={[Math.cos(a) * (TABLE_R + 0.85), 0, Math.sin(a) * (TABLE_R + 0.85)]}
            rotation={[0, -a + Math.PI / 2, 0]}
          />
        );
      })}

      {/* pendant lamps over the table */}
      {[[-0.95, 0], [0.95, 0], [0, 0.95], [0, -0.95]].map(([x, z], i) => (
        <group key={i} position={[x, 0, z]}>
          <mesh position={[0, 2.95, 0]}>
            <cylinderGeometry args={[0.008, 0.008, 1.3, 6]} />
            <meshStandardMaterial color="#2a2a32" />
          </mesh>
          <mesh position={[0, 2.28, 0]} castShadow>
            <coneGeometry args={[0.2, 0.24, 16, 1, true]} />
            <meshStandardMaterial color="#2b2118" roughness={0.5} metalness={0.5} side={THREE.DoubleSide} />
          </mesh>
          <mesh position={[0, 2.2, 0]}>
            <sphereGeometry args={[0.065, 12, 12]} />
            <meshStandardMaterial color="#ffe6bd" emissive="#ffdca8" emissiveIntensity={2.6} toneMapped={false} />
          </mesh>
        </group>
      ))}

      {/* cornice, in place of a ceiling that would block the camera */}
      {[[0, -D / 2, 0], [0, D / 2, Math.PI], [-W / 2, 0, Math.PI / 2], [W / 2, 0, -Math.PI / 2]].map(([x, z, ry], i) => (
        <mesh key={i} position={[x, H - 0.02, z]} rotation={[0, ry, 0]}>
          <planeGeometry args={[W, 0.1]} />
          <meshBasicMaterial color="#3a3040" side={THREE.FrontSide} />
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
    let dist = 18, zoom = 88;
    if (mode === 'table') { aim.current.set(0, 1.0, 0); dist = 12; zoom = 118; }
    else if (mode === 'station' && focusIndex != null) {
      const p = stationPos(focusIndex);
      aim.current.set(p.x * 0.8, 1.0, p.z * 0.8); dist = 10; zoom = 150;
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
      <fog attach="fog" args={['#050507', 20, 45]} />
      <ambientLight intensity={0.6} color="#b9c2d8" />
      <directionalLight
        position={[6, 10, 5]} intensity={0.9} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-18} shadow-camera-right={18}
        shadow-camera-top={18} shadow-camera-bottom={-18}
      />
      {/* the rig over the table is the room's key practical light */}
      {/* the four pendants are the room's key light */}
      {[[-1.5,0],[1.5,0],[0,1.5],[0,-1.5]].map(([x,z],i)=>(
        <pointLight key={i} position={[x,2.2,z]} distance={7} intensity={act ? 9 : 6} color="#ffdcae" />
      ))}
      <pointLight position={[0,2.2,-6]} distance={9} intensity={2.6} color="#7ea6ff" />
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

      <ContactShadows position={[0, 0.012, 0]} opacity={0.5} scale={16} blur={2} far={4} />
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
