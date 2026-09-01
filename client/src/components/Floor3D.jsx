import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoundedBox, ContactShadows, useGLTF, useAnimations } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing';
import { clone as cloneSkeleton } from 'three/examples/jsm/utils/SkeletonUtils.js';
import * as THREE from 'three';
import { getFloor } from '../api';
import { AgentPanel, AgentChat } from './floor/shared';

const MODEL = '/models/robot.glb';
useGLTF.preload(MODEL);

/* ------------------------------------------------------------------ layout */
const GAP = 5.4;
const roomPos = (i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  return new THREE.Vector3((col - 1) * GAP, 0, (row - 0.5) * GAP);
};
const ISO = new THREE.Vector3(1, 1.05, 1).normalize();
const damp = (c, t, l, dt) => THREE.MathUtils.lerp(c, t, 1 - Math.exp(-l * dt));

// reaction cue -> clip name in RobotExpressive
const CLIP = {
  idle: 'Idle', wave: 'Wave', yes: 'Yes', no: 'No',
  thumbsup: 'ThumbsUp', dance: 'Dance', punch: 'Punch', walking: 'Walking',
};
const ONESHOT = new Set(['Wave', 'Yes', 'No', 'ThumbsUp', 'Punch']);

/* ------------------------------------------------------------------- robot */
function Robot({ color, focused, reaction = 'idle', busy = false }) {
  const group = useRef();
  const { scene, animations } = useGLTF(MODEL);
  const model = useMemo(() => {
    const c = cloneSkeleton(scene);
    const tint = new THREE.Color(color);
    c.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material?.name === 'Main') {
        o.material = o.material.clone();
        o.material.color.copy(tint);
        o.material.emissive = tint.clone().multiplyScalar(0.12);
        o.material.metalness = 0.25;
        o.material.roughness = 0.5;
      }
    });
    return c;
  }, [scene, color]);

  const { actions, mixer } = useAnimations(animations, group);
  const seed = useMemo(() => Math.random() * 5, []);

  // base loop always plays underneath: Idle, or Walking (pacing) when busy
  useEffect(() => {
    const base = actions[busy ? 'Walking' : 'Idle'];
    if (!base) return;
    base.reset().fadeIn(0.35).play();
    return () => base.fadeOut(0.35);
  }, [actions, busy]);

  // reactions play once (or a few loops for Dance) over the base, then fade out
  useEffect(() => {
    const clip = CLIP[reaction];
    if (!clip || clip === 'Idle' || clip === 'Walking') return;
    const a = actions[clip];
    if (!a) return;
    const oneShot = ONESHOT.has(clip);
    a.reset();
    a.setLoop(oneShot ? THREE.LoopOnce : THREE.LoopRepeat, Infinity);
    a.clampWhenFinished = true;
    a.setEffectiveWeight(1).fadeIn(0.25).play();
    let timer;
    const onFinish = (e) => { if (e.action === a) a.fadeOut(0.45); };
    if (oneShot) mixer.addEventListener('finished', onFinish);
    else timer = setTimeout(() => a.fadeOut(0.5), 3200);
    return () => {
      mixer.removeEventListener('finished', onFinish);
      clearTimeout(timer);
      a.fadeOut(0.2);
    };
  }, [actions, mixer, reaction]);

  useFrame((s, dt) => {
    const g = group.current;
    if (!g) return;
    const t = s.clock.elapsedTime + seed;
    g.rotation.y = damp(g.rotation.y, focused ? 0.7 : 0.4 + Math.sin(t * 0.25) * 0.35, 2.5, dt);
    g.position.y = damp(g.position.y, Math.sin(t * 1.1) * 0.015, 5, dt);
  });

  return (
    <group ref={group} dispose={null}>
      <primitive object={model} scale={0.42} />
    </group>
  );
}

/* -------------------------------------------------------------- workstation */
function Plinth({ agent, index, focused, dim, live, onSelect }) {
  const p = roomPos(index);
  const grp = useRef();
  const inlay = useRef();
  const c = useMemo(() => new THREE.Color(agent.color), [agent.color]);
  const S = 3;

  useFrame((s, dt) => {
    if (grp.current) grp.current.position.y = damp(grp.current.position.y, focused ? 0.16 : 0, 8, dt);
    if (inlay.current) {
      const em = focused ? 2.4 : dim ? 0.08 : 0.55;
      inlay.current.material.emissiveIntensity = damp(inlay.current.material.emissiveIntensity, em, 6, dt);
    }
  });

  return (
    <group ref={grp} position={p}>
      <mesh
        position={[0, 1, 0]}
        onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}
        onPointerOver={(e) => { e.stopPropagation(); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { document.body.style.cursor = 'default'; }}
      >
        <boxGeometry args={[S, 3, S]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} colorWrite={false} />
      </mesh>

      {/* plinth block */}
      <RoundedBox args={[S, 0.7, S]} radius={0.08} smoothness={4} position={[0, -0.35, 0]} receiveShadow castShadow>
        <meshStandardMaterial color={dim ? '#101013' : '#1a1a20'} metalness={0.25} roughness={0.6} />
      </RoundedBox>
      {/* thin accent frame inset on the top edge */}
      {[[0, (S - 0.28) / 2], [0, -(S - 0.28) / 2], [(S - 0.28) / 2, 0], [-(S - 0.28) / 2, 0]].map(([x, z], i) => (
        <mesh key={i} ref={i === 0 ? inlay : undefined} position={[x, 0.01, z]}>
          <boxGeometry args={i < 2 ? [S - 0.18, 0.02, 0.05] : [0.05, 0.02, S - 0.18]} />
          <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.55} toneMapped={false} />
        </mesh>
      ))}

      <Robot
        color={agent.color}
        focused={focused}
        reaction={live?.reaction || 'idle'}
        busy={!!live?.busy}
      />

      <pointLight position={[0.8, 2.2, 1]} distance={5} intensity={focused ? 2.4 : dim ? 0.2 : 0.6} color={c} />
    </group>
  );
}

/* -------------------------------------------------------------------- rig */
function Rig({ focusIndex }) {
  const { camera } = useThree();
  const tgt = useRef(new THREE.Vector3(0, 0.7, 0));
  const aim = useRef(new THREE.Vector3());
  const pos = useRef(new THREE.Vector3());
  useFrame((s, dt) => {
    const t = s.clock.elapsedTime;
    const focused = focusIndex != null;
    const fp = focused ? roomPos(focusIndex) : new THREE.Vector3(0, 0, 0);
    aim.current.set(fp.x, focused ? 0.95 : 0.6, fp.z + (focused ? 0.1 : 0));
    pos.current.copy(aim.current).addScaledVector(ISO, focused ? 12 : 24);
    pos.current.x += Math.sin(t * 0.15) * (focused ? 0.12 : 0.4);
    pos.current.y += Math.sin(t * 0.11) * 0.14;
    ['x', 'y', 'z'].forEach((k) => {
      camera.position[k] = damp(camera.position[k], pos.current[k], 3, dt);
      tgt.current[k] = damp(tgt.current[k], aim.current[k], 3.4, dt);
    });
    camera.lookAt(tgt.current);
    camera.zoom = damp(camera.zoom, focused ? 118 : 58, 3, dt);
    camera.updateProjectionMatrix();
  });
  return null;
}

function Effects() {
  return (
    <EffectComposer disableNormalPass multisampling={0}>
      <Bloom mipmapBlur luminanceThreshold={0.68} luminanceSmoothing={0.25} intensity={0.5} radius={0.5} />
      <Vignette eskil={false} offset={0.28} darkness={0.7} />
      <SMAA />
    </EffectComposer>
  );
}

function Scene({ agents, live, sel, setSel }) {
  const selIndex = sel == null ? null : agents.findIndex((a) => a.id === sel);
  return (
    <>
      <color attach="background" args={['#070709']} />
      <fog attach="fog" args={['#070709', 22, 50]} />
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[7, 13, 5]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      <directionalLight position={[-9, 5, -7]} intensity={0.4} color="#7c88ff" />

      <Suspense fallback={null}>
        {agents.map((a, i) => (
          <Plinth
            key={a.id}
            agent={a}
            index={i}
            focused={sel === a.id}
            dim={sel != null && sel !== a.id}
            live={live?.agents?.[a.id]}
            onSelect={setSel}
          />
        ))}
      </Suspense>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.55, 0]} onClick={() => setSel(null)}>
        <planeGeometry args={[80, 80]} />
        <meshStandardMaterial color="#08080a" metalness={0.3} roughness={0.95} />
      </mesh>
      <ContactShadows position={[0, -0.5, 0]} opacity={0.5} scale={28} blur={2.6} far={5} />

      <Rig focusIndex={selIndex} />
      <Effects />
    </>
  );
}

/* --------------------------------------------------------------- exported */
export default function Floor3D({ onAnalyze, onExit }) {
  const [floor, setFloor] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);

  useEffect(() => {
    let alive = true;
    getFloor().then((f) => alive && setFloor(f)).catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, []);

  if (err) return <p className="text-xs text-red-400">{err}</p>;
  if (!floor) return <p className="text-xs text-haze animate-pulse">Loading the floor…</p>;

  const agents = floor.agents;
  const selAgent = sel == null ? null : agents.find((a) => a.id === sel);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm text-neutral-200">The Floor</h1>
          <p className="text-[11px] text-haze">
            {sel ? 'Tap the void to step back out.' : 'Six analysts at work. Tap one to visit.'}
          </p>
        </div>
        <button onClick={onExit} className="text-[11px] text-haze hover:text-neutral-300 shrink-0">cards view</button>
      </div>

      <div className="relative">
        <div className="rounded-2xl overflow-hidden border border-ink-800 bg-[#070709]" style={{ height: 'min(66vh, 520px)' }}>
          <Canvas
            shadows
            dpr={[1, 1.8]}
            gl={{ antialias: false, powerPreference: 'high-performance' }}
            orthographic
            camera={{ position: [28, 30, 28], zoom: 46, near: 0.1, far: 240 }}
            onPointerMissed={() => setSel(null)}
          >
            <Suspense fallback={null}>
              <Scene agents={agents} live={floor.live} sel={sel} setSel={setSel} />
            </Suspense>
          </Canvas>
        </div>

        <div className="absolute top-3 left-3 flex flex-col gap-1">
          {agents.map((a) => {
            const l = floor.live?.agents?.[a.id];
            return (
              <button
                key={a.id}
                onClick={() => setSel(a.id)}
                className={`group flex items-center gap-2 text-left text-[11px] font-mono tracking-wider pl-1.5 pr-2.5 py-1 rounded-md border transition-all ${
                  sel === a.id
                    ? 'bg-ink-850/90 border-ink-700 text-neutral-100'
                    : 'bg-ink-950/50 border-transparent text-haze hover:text-neutral-300 hover:bg-ink-900/60'
                }`}
              >
                <span
                  className="h-1.5 w-1.5 rounded-full shrink-0"
                  style={{ background: a.color, boxShadow: sel === a.id ? `0 0 8px ${a.color}` : 'none' }}
                />
                {a.name}
                {l?.busy && <span className="ml-1 text-[9px] text-emerald-400 animate-pulse">●</span>}
              </button>
            );
          })}
        </div>

        {sel && (
          <button
            onClick={() => setSel(null)}
            className="absolute top-3 right-3 text-[11px] text-haze hover:text-neutral-200 bg-ink-950/60 rounded-md px-2 py-1"
          >
            ← all rooms
          </button>
        )}
      </div>

      {selAgent && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs tracking-wider" style={{ color: selAgent.color }}>
              {selAgent.emoji} {selAgent.name}
            </span>
            <span className="text-[11px] uppercase tracking-wide text-haze">{selAgent.role}</span>
          </div>
          <AgentPanel agent={selAgent} data={floor.perAgent[selAgent.id]} onAnalyze={onAnalyze} />
          <AgentChat agent={selAgent} />
        </div>
      )}
    </div>
  );
}
