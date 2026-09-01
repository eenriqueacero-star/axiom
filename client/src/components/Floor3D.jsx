import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoundedBox, ContactShadows, MeshReflectorMaterial } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing';
import * as THREE from 'three';
import { getFloor } from '../api';
import { AgentPanel, AgentChat } from './floor/shared';

/* ------------------------------------------------------------------ layout */
const GAP = 6.2;
const roomPos = (i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  return new THREE.Vector3((col - 1) * GAP, 0, (row - 0.5) * GAP);
};
const ISO = new THREE.Vector3(1, 0.85, 1).normalize();
const damp = (cur, tgt, lambda, dt) =>
  THREE.MathUtils.lerp(cur, tgt, 1 - Math.exp(-lambda * dt));

/* ------------------------------------------------------------------- robot */
function Bot({ color, focused }) {
  const g = useRef();
  const head = useRef();
  const arm = useRef();
  const eye = useRef();
  const seed = useMemo(() => Math.random() * 100, []);
  const glance = useRef(0);

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime + seed;
    const grp = g.current;
    if (!grp) return;
    // breathing + hover
    const breathe = 1 + Math.sin(t * 1.8) * 0.02;
    grp.scale.setScalar(breathe);
    grp.position.y = damp(grp.position.y, 0.92 + Math.sin(t * 1.3) * 0.03, 6, dt);
    // idle glances, or face camera when focused
    if (focused) {
      grp.rotation.y = damp(grp.rotation.y, 0.5, 5, dt);
    } else {
      if (t > glance.current) glance.current = t + 2 + Math.random() * 4;
      const look = Math.sin(t * 0.4 + seed) * 0.5;
      grp.rotation.y = damp(grp.rotation.y, look, 2, dt);
    }
    if (head.current) head.current.rotation.z = Math.sin(t * 0.7) * 0.05;
    // wave on focus
    if (arm.current) {
      const target = focused ? -1.9 + Math.sin(t * 13) * 0.5 : 0.2;
      arm.current.rotation.z = damp(arm.current.rotation.z, target, 8, dt);
    }
    if (eye.current) {
      const blink = (Math.sin(t * 0.9) > 0.98) ? 0.15 : 1;
      eye.current.scale.y = damp(eye.current.scale.y, blink, 20, dt);
      eye.current.material.emissiveIntensity = focused ? 2.4 : 1.3;
    }
  });

  const body = new THREE.Color(color);
  const shell = body.clone().lerp(new THREE.Color('#f4f4f6'), 0.35);
  const dark = body.clone().multiplyScalar(0.4);

  return (
    <group ref={g} position={[0, 0.92, 0]}>
      {/* torso */}
      <RoundedBox args={[0.62, 0.72, 0.44]} radius={0.16} smoothness={4} castShadow>
        <meshStandardMaterial color={shell} metalness={0.35} roughness={0.35} />
      </RoundedBox>
      {/* chest light */}
      <mesh position={[0, 0.05, 0.225]}>
        <circleGeometry args={[0.08, 20]} />
        <meshStandardMaterial color={body} emissive={body} emissiveIntensity={1.6} toneMapped={false} />
      </mesh>
      {/* head */}
      <group ref={head} position={[0, 0.62, 0]}>
        <RoundedBox args={[0.5, 0.42, 0.42]} radius={0.17} smoothness={4} castShadow>
          <meshStandardMaterial color={shell} metalness={0.35} roughness={0.3} />
        </RoundedBox>
        <mesh ref={eye} position={[0, 0.02, 0.21]}>
          <boxGeometry args={[0.28, 0.08, 0.04]} />
          <meshStandardMaterial color="#0b0b0d" emissive={body} emissiveIntensity={1.3} toneMapped={false} />
        </mesh>
        {/* antenna */}
        <mesh position={[0, 0.32, 0]}>
          <cylinderGeometry args={[0.012, 0.012, 0.22, 6]} />
          <meshStandardMaterial color={dark} />
        </mesh>
        <mesh position={[0, 0.45, 0]}>
          <sphereGeometry args={[0.035, 12, 12]} />
          <meshStandardMaterial color={body} emissive={body} emissiveIntensity={2.2} toneMapped={false} />
        </mesh>
      </group>
      {/* arms */}
      <group ref={arm} position={[0.36, 0.16, 0]}>
        <mesh position={[0.02, -0.22, 0]} castShadow>
          <capsuleGeometry args={[0.07, 0.36, 4, 10]} />
          <meshStandardMaterial color={body} metalness={0.3} roughness={0.4} />
        </mesh>
      </group>
      <mesh position={[-0.38, -0.06, 0]} castShadow>
        <capsuleGeometry args={[0.07, 0.36, 4, 10]} />
        <meshStandardMaterial color={body} metalness={0.3} roughness={0.4} />
      </mesh>
      {/* feet */}
      {[-0.16, 0.16].map((x) => (
        <mesh key={x} position={[x, -0.52, 0.02]} castShadow>
          <RoundedBox args={[0.2, 0.16, 0.3]} radius={0.07} smoothness={3}>
            <meshStandardMaterial color={dark} metalness={0.2} roughness={0.6} />
          </RoundedBox>
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------- props */
function Prop({ id, color }) {
  const spin = useRef();
  const bob = useRef();
  const seed = useMemo(() => Math.random() * 10, []);
  useFrame((s, d) => {
    if (spin.current) spin.current.rotation.y += d * 0.5;
    if (bob.current) bob.current.position.y = 1.15 + Math.sin(s.clock.elapsedTime * 2 + seed) * 0.06;
  });
  const c = new THREE.Color(color);
  const emit = (i = 1) => (
    <meshStandardMaterial color="#0a0a0c" emissive={c} emissiveIntensity={i} toneMapped={false} />
  );

  if (id === 'trend') {
    return (
      <group position={[-1.55, 1.15, -1.55]} rotation={[0, Math.PI / 4, 0]}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[(i % 2) * 0.82 - 0.41, Math.floor(i / 2) * 0.62 - 0.31, 0]}>
            <boxGeometry args={[0.74, 0.52, 0.05]} />
            {emit(0.7 + (i % 3) * 0.25)}
          </mesh>
        ))}
      </group>
    );
  }
  if (id === 'catalyst') {
    return (
      <group ref={bob} position={[-1.4, 1.15, -1.4]} rotation={[0, 0, 0.1]}>
        <mesh position={[0, 0.55, 0]} castShadow>
          <coneGeometry args={[0.26, 0.55, 20]} />
          <meshStandardMaterial color={c} metalness={0.4} roughness={0.25} />
        </mesh>
        <mesh castShadow>
          <cylinderGeometry args={[0.26, 0.26, 0.85, 20]} />
          <meshStandardMaterial color="#e9e9ec" metalness={0.35} roughness={0.3} />
        </mesh>
        {[0, 1, 2].map((i) => (
          <mesh key={i} rotation={[0, (i * Math.PI * 2) / 3, 0]} position={[0, -0.4, 0]}>
            <mesh position={[0.22, 0, 0]}>
              <coneGeometry args={[0.12, 0.34, 4]} />
              <meshStandardMaterial color={c} metalness={0.4} roughness={0.3} />
            </mesh>
          </mesh>
        ))}
        <mesh position={[0, -0.62, 0]}>
          <coneGeometry args={[0.13, 0.4, 12]} />
          <meshStandardMaterial color="#ffb020" emissive="#ff8a00" emissiveIntensity={2.5} toneMapped={false} />
        </mesh>
      </group>
    );
  }
  if (id === 'sector') {
    return (
      <group position={[-1.4, 1.2, -1.4]}>
        <mesh ref={spin}>
          <sphereGeometry args={[0.44, 24, 24]} />
          <meshStandardMaterial color={c} metalness={0.2} roughness={0.5} wireframe />
        </mesh>
        <mesh>
          <sphereGeometry args={[0.4, 24, 24]} />
          <meshBasicMaterial color={c} transparent opacity={0.12} />
        </mesh>
      </group>
    );
  }
  if (id === 'bear') {
    return (
      <group position={[-1.35, 0.55, -1.35]}>
        <RoundedBox args={[0.8, 0.9, 0.7]} radius={0.28} smoothness={4} castShadow>
          <meshStandardMaterial color="#241315" roughness={0.9} />
        </RoundedBox>
        {[-0.22, 0.22].map((x) => (
          <mesh key={x} position={[x, 0.55, 0]}>
            <sphereGeometry args={[0.14, 12, 12]} />
            <meshStandardMaterial color="#241315" roughness={0.9} />
          </mesh>
        ))}
        {[-0.12, 0.12].map((x) => (
          <mesh key={x} position={[x, 0.12, 0.34]}>
            <sphereGeometry args={[0.035, 8, 8]} />
            <meshStandardMaterial color={c} emissive={c} emissiveIntensity={2} toneMapped={false} />
          </mesh>
        ))}
      </group>
    );
  }
  if (id === 'quality') {
    return (
      <group position={[-1.7, 0, -1.6]} rotation={[0, Math.PI / 5, 0]}>
        {[0.42, 0.98, 1.54].map((y) => (
          <mesh key={y} position={[0, y, 0]} castShadow>
            <boxGeometry args={[1.5, 0.1, 0.42]} />
            <meshStandardMaterial color="#4a3b30" roughness={0.85} />
          </mesh>
        ))}
        {Array.from({ length: 7 }).map((_, i) => (
          <mesh key={i} position={[-0.62 + i * 0.2, 0.62, 0]}>
            <boxGeometry args={[0.13, 0.34, 0.34]} />
            <meshStandardMaterial color={new THREE.Color().setHSL((i * 0.13 + 0.05) % 1, 0.35, 0.42)} roughness={0.7} />
          </mesh>
        ))}
        <group position={[1.15, 0.32, 0.35]}>
          <mesh castShadow><cylinderGeometry args={[0.14, 0.18, 0.34, 10]} /><meshStandardMaterial color="#6b4f3a" roughness={0.8} /></mesh>
          <mesh position={[0, 0.4, 0]}><icosahedronGeometry args={[0.3, 0]} /><meshStandardMaterial color="#2f8f4e" flatShading roughness={0.7} /></mesh>
        </group>
      </group>
    );
  }
  // sizing — balance scale
  return (
    <group position={[-1.35, 0.7, -1.35]}>
      <mesh castShadow><cylinderGeometry args={[0.045, 0.06, 1.35, 10]} /><meshStandardMaterial color="#8a8a94" metalness={0.7} roughness={0.3} /></mesh>
      <mesh ref={spin} position={[0, 0.66, 0]}>
        <boxGeometry args={[1.4, 0.05, 0.05]} />
        <meshStandardMaterial color="#9a9aa4" metalness={0.7} roughness={0.25} />
      </mesh>
      {[-0.62, 0.62].map((x, i) => (
        <mesh key={x} position={[x, 0.42 + (i === 0 ? -0.05 : 0.05), 0]}>
          <cylinderGeometry args={[0.2, 0.14, 0.12, 16]} />
          <meshStandardMaterial color={c} metalness={0.3} roughness={0.4} emissive={c} emissiveIntensity={0.25} />
        </mesh>
      ))}
    </group>
  );
}

/* -------------------------------------------------------------- room shell */
function RoomCell({ agent, index, focused, dim, hovered, onSelect, onHover }) {
  const p = roomPos(index);
  const grp = useRef();
  const glow = useRef();
  const c = useMemo(() => new THREE.Color(agent.color), [agent.color]);

  useFrame((s, dt) => {
    if (grp.current) {
      const lift = focused ? 0.18 : hovered ? 0.08 : 0;
      grp.current.position.y = damp(grp.current.position.y, lift, 8, dt);
    }
    if (glow.current) {
      const target = focused ? 0.55 : dim ? 0.03 : 0.14;
      glow.current.material.opacity = damp(glow.current.material.opacity, target, 6, dt);
    }
  });

  return (
    <group
      ref={grp}
      position={p}
      onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover(agent.id); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { onHover(null); document.body.style.cursor = 'default'; }}
    >
      {/* floor slab */}
      <RoundedBox args={[4.7, 0.35, 4.7]} radius={0.12} smoothness={4} position={[0, -0.175, 0]} receiveShadow>
        <meshStandardMaterial color={dim ? '#0c0c0e' : '#17171b'} metalness={0.1} roughness={0.85} />
      </RoundedBox>
      {/* tinted inlay */}
      <mesh ref={glow} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <planeGeometry args={[4.2, 4.2]} />
        <meshBasicMaterial color={c} transparent opacity={0.14} toneMapped={false} />
      </mesh>
      {/* corner frame posts */}
      {[[-2.25, -2.25], [2.25, -2.25], [-2.25, 2.25]].map(([x, z], i) => (
        <mesh key={i} position={[x, 1.05, z]}>
          <boxGeometry args={[0.08, 2.6, 0.08]} />
          <meshStandardMaterial color="#26262c" metalness={0.6} roughness={0.4} />
        </mesh>
      ))}
      {/* back + left low panels */}
      <mesh position={[0, 0.55, -2.25]}>
        <boxGeometry args={[4.6, 1.5, 0.06]} />
        <meshStandardMaterial color="#101013" metalness={0.2} roughness={0.7} transparent opacity={dim ? 0.25 : 0.9} />
      </mesh>
      <mesh position={[-2.25, 0.55, 0]}>
        <boxGeometry args={[0.06, 1.5, 4.6]} />
        <meshStandardMaterial color="#0d0d10" metalness={0.2} roughness={0.7} transparent opacity={dim ? 0.2 : 0.75} />
      </mesh>

      <group visible={!dim}>
        <Prop id={agent.id} color={agent.color} />
      </group>
      <Bot color={agent.color} focused={focused} />

      <pointLight
        position={[0.8, 2.4, 0.8]}
        distance={6.5}
        intensity={focused ? 6 : dim ? 0.5 : 2.2}
        color={c}
      />
      {focused && <pointLight position={[-1, 1, 1.5]} distance={4} intensity={2} color="#ffffff" />}
    </group>
  );
}

/* ------------------------------------------------------------------ motes */
function Motes() {
  const ref = useRef();
  const geo = useMemo(() => {
    const n = 120;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 22;
      arr[i * 3 + 1] = Math.random() * 8;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 16;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }, []);
  useFrame((s) => {
    if (ref.current) ref.current.rotation.y = s.clock.elapsedTime * 0.02;
  });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial size={0.03} color="#8a8a9a" transparent opacity={0.5} sizeAttenuation />
    </points>
  );
}

/* -------------------------------------------------------------------- rig */
function Rig({ focusIndex }) {
  const { camera } = useThree();
  const tgt = useRef(new THREE.Vector3(0, 0, 0));
  const aim = useRef(new THREE.Vector3());
  const pos = useRef(new THREE.Vector3());

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime;
    const focused = focusIndex != null;
    const fp = focused ? roomPos(focusIndex) : new THREE.Vector3(0, 0, 0);
    aim.current.set(fp.x + (focused ? 0.3 : 0), focused ? 1.0 : 0.2, fp.z + (focused ? 0.3 : 0));
    const dist = focused ? 15 : 26;
    pos.current.copy(aim.current).addScaledVector(ISO, dist);
    // idle parallax
    pos.current.x += Math.sin(t * 0.18) * (focused ? 0.25 : 0.9);
    pos.current.y += Math.sin(t * 0.13) * 0.3;

    camera.position.x = damp(camera.position.x, pos.current.x, 3.5, dt);
    camera.position.y = damp(camera.position.y, pos.current.y, 3.5, dt);
    camera.position.z = damp(camera.position.z, pos.current.z, 3.5, dt);
    tgt.current.x = damp(tgt.current.x, aim.current.x, 4, dt);
    tgt.current.y = damp(tgt.current.y, aim.current.y, 4, dt);
    tgt.current.z = damp(tgt.current.z, aim.current.z, 4, dt);
    camera.lookAt(tgt.current);

    const wantZoom = focused ? 96 : 46;
    camera.zoom = damp(camera.zoom, wantZoom, 3.5, dt);
    camera.updateProjectionMatrix();
  });
  return null;
}

function Effects() {
  return (
    <EffectComposer disableNormalPass multisampling={0}>
      <Bloom mipmapBlur luminanceThreshold={0.55} luminanceSmoothing={0.3} intensity={0.7} radius={0.6} />
      <Vignette eskil={false} offset={0.25} darkness={0.75} />
      <SMAA />
    </EffectComposer>
  );
}

/* ------------------------------------------------------------------ scene */
function Scene({ agents, sel, setSel }) {
  const [hover, setHover] = useState(null);
  const selIndex = sel == null ? null : agents.findIndex((a) => a.id === sel);
  return (
    <>
      <color attach="background" args={['#070709']} />
      <fog attach="fog" args={['#070709', 22, 46]} />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[8, 14, 6]}
        intensity={1.5}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
      />
      {/* cool rim + warm fill, no external HDR */}
      <directionalLight position={[-10, 6, -8]} intensity={0.5} color="#6b7cff" />
      <directionalLight position={[0, 3, 12]} intensity={0.35} color="#ffd9a8" />

      <Suspense fallback={null}>
        {agents.map((a, i) => (
          <RoomCell
            key={a.id}
            agent={a}
            index={i}
            focused={sel === a.id}
            dim={sel != null && sel !== a.id}
            hovered={hover === a.id}
            onSelect={setSel}
            onHover={setHover}
          />
        ))}
      </Suspense>

      {/* reflective ground */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.4, 0]}>
        <planeGeometry args={[60, 60]} />
        <MeshReflectorMaterial
          resolution={512}
          mirror={0.35}
          mixBlur={8}
          mixStrength={1.2}
          blur={[200, 60]}
          roughness={0.9}
          depthScale={0.8}
          color="#0a0a0c"
          metalness={0.4}
        />
      </mesh>
      <ContactShadows position={[0, -0.38, 0]} opacity={0.55} scale={26} blur={2.4} far={5} />

      <Motes />
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

  useEffect(() => { getFloor().then(setFloor).catch((e) => setErr(e.message)); }, []);

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
            {sel ? 'Tap the void to step back out.' : 'Six analysts, one house. Tap a room to visit.'}
          </p>
        </div>
        <button onClick={onExit} className="text-[11px] text-haze hover:text-neutral-300 shrink-0">
          cards view
        </button>
      </div>

      <div className="relative">
        <div
          className="rounded-2xl overflow-hidden border border-ink-800 bg-[#070709]"
          style={{ height: 'min(66vh, 520px)' }}
        >
          <Canvas
            shadows
            dpr={[1, 1.8]}
            gl={{ antialias: false, powerPreference: 'high-performance' }}
            orthographic
            camera={{ position: [26, 22, 26], zoom: 46, near: 0.1, far: 200 }}
            onPointerMissed={() => setSel(null)}
          >
            <Scene agents={agents} sel={sel} setSel={setSel} />
          </Canvas>
        </div>

        {/* side nav */}
        <div className="absolute top-3 left-3 flex flex-col gap-1">
          {agents.map((a) => (
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
            </button>
          ))}
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
