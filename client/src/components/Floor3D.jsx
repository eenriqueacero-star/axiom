import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoundedBox, ContactShadows, MeshReflectorMaterial } from '@react-three/drei';
import { EffectComposer, Bloom, Vignette, SMAA } from '@react-three/postprocessing';
import * as THREE from 'three';
import { getFloor } from '../api';
import { AgentPanel, AgentChat } from './floor/shared';

/* ------------------------------------------------------------------ layout */
const GAP = 7.4;
const roomPos = (i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  return new THREE.Vector3((col - 1) * GAP, 0, (row - 0.5) * GAP);
};
const ISO = new THREE.Vector3(1, 1.15, 1).normalize();
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
    grp.scale.setScalar(1 + Math.sin(t * 1.8) * 0.018);
    grp.position.y = damp(grp.position.y, 0.9 + Math.sin(t * 1.3) * 0.028, 6, dt);
    if (focused) {
      grp.rotation.y = damp(grp.rotation.y, 0.5, 5, dt);
    } else {
      if (t > glance.current) glance.current = t + 2 + Math.random() * 4;
      grp.rotation.y = damp(grp.rotation.y, Math.sin(t * 0.4 + seed) * 0.5, 2, dt);
    }
    if (head.current) head.current.rotation.z = Math.sin(t * 0.7) * 0.05;
    if (arm.current) {
      arm.current.rotation.z = damp(
        arm.current.rotation.z,
        focused ? -1.9 + Math.sin(t * 13) * 0.5 : 0.2,
        8,
        dt,
      );
    }
    if (eye.current) {
      eye.current.scale.y = damp(eye.current.scale.y, Math.sin(t * 0.9) > 0.98 ? 0.15 : 1, 20, dt);
      eye.current.material.emissiveIntensity = focused ? 2.6 : 1.5;
    }
  });

  const body = new THREE.Color(color);
  const shell = body.clone().lerp(new THREE.Color('#e7e7ea'), 0.72);
  const dark = new THREE.Color('#1c1c20');

  return (
    <group ref={g} position={[0, 0.9, 0]}>
      <RoundedBox args={[0.6, 0.7, 0.42]} radius={0.16} smoothness={4} castShadow>
        <meshStandardMaterial color={shell} metalness={0.2} roughness={0.45} />
      </RoundedBox>
      <mesh position={[0, 0.04, 0.215]}>
        <circleGeometry args={[0.07, 20]} />
        <meshStandardMaterial color={body} emissive={body} emissiveIntensity={1.8} toneMapped={false} />
      </mesh>
      <group ref={head} position={[0, 0.6, 0]}>
        <RoundedBox args={[0.48, 0.4, 0.4]} radius={0.17} smoothness={4} castShadow>
          <meshStandardMaterial color={shell} metalness={0.2} roughness={0.4} />
        </RoundedBox>
        <mesh ref={eye} position={[0, 0.02, 0.2]}>
          <boxGeometry args={[0.27, 0.075, 0.04]} />
          <meshStandardMaterial color="#0b0b0d" emissive={body} emissiveIntensity={1.5} toneMapped={false} />
        </mesh>
        <mesh position={[0, 0.3, 0]}>
          <cylinderGeometry args={[0.011, 0.011, 0.2, 6]} />
          <meshStandardMaterial color={dark} />
        </mesh>
        <mesh position={[0, 0.42, 0]}>
          <sphereGeometry args={[0.032, 12, 12]} />
          <meshStandardMaterial color={body} emissive={body} emissiveIntensity={2.4} toneMapped={false} />
        </mesh>
      </group>
      <group ref={arm} position={[0.34, 0.15, 0]}>
        <mesh position={[0.02, -0.2, 0]} castShadow>
          <capsuleGeometry args={[0.065, 0.34, 4, 10]} />
          <meshStandardMaterial color={shell} metalness={0.2} roughness={0.5} />
        </mesh>
      </group>
      <mesh position={[-0.36, -0.05, 0]} castShadow>
        <capsuleGeometry args={[0.065, 0.34, 4, 10]} />
        <meshStandardMaterial color={shell} metalness={0.2} roughness={0.5} />
      </mesh>
      {[-0.15, 0.15].map((x) => (
        <mesh key={x} position={[x, -0.52, 0.02]} castShadow>
          <RoundedBox args={[0.19, 0.15, 0.28]} radius={0.06} smoothness={3}>
            <meshStandardMaterial color={dark} metalness={0.1} roughness={0.6} />
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
    if (spin.current) spin.current.rotation.y += d * 0.4;
    if (bob.current) bob.current.position.y = Math.sin(s.clock.elapsedTime * 1.6 + seed) * 0.05;
  });
  const c = new THREE.Color(color);
  const panel = <meshStandardMaterial color="#0c0c0e" emissive={c} emissiveIntensity={0.9} toneMapped={false} />;

  // everything sits in the back-left corner, small, out of the robot's space
  const inner = (() => {
    if (id === 'trend') {
      return (
        <group position={[0, 0.9, 0]}>
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <mesh key={i} position={[(i % 3) * 0.44 - 0.44, Math.floor(i / 3) * 0.4 - 0.2, 0]}>
              <boxGeometry args={[0.4, 0.32, 0.03]} />
              {i % 2 ? panel : <meshStandardMaterial color="#0c0c0e" emissive={c} emissiveIntensity={0.4} toneMapped={false} />}
            </mesh>
          ))}
        </group>
      );
    }
    if (id === 'catalyst') {
      return (
        <group ref={bob} position={[0, 0.7, 0]} rotation={[0, 0, 0.08]} scale={0.62}>
          <mesh position={[0, 0.5, 0]} castShadow><coneGeometry args={[0.24, 0.5, 18]} /><meshStandardMaterial color={c} metalness={0.3} roughness={0.3} /></mesh>
          <mesh castShadow><cylinderGeometry args={[0.24, 0.24, 0.8, 18]} /><meshStandardMaterial color="#e2e2e5" metalness={0.2} roughness={0.4} /></mesh>
          <mesh position={[0, -0.58, 0]}><coneGeometry args={[0.12, 0.34, 12]} /><meshStandardMaterial color="#ffb347" emissive="#ff8a00" emissiveIntensity={2.2} toneMapped={false} /></mesh>
        </group>
      );
    }
    if (id === 'sector') {
      return (
        <group position={[0, 0.6, 0]}>
          <mesh position={[0, -0.3, 0]} castShadow><cylinderGeometry args={[0.12, 0.16, 0.24, 12]} /><meshStandardMaterial color="#1a1a1e" metalness={0.4} roughness={0.5} /></mesh>
          <mesh ref={spin}><sphereGeometry args={[0.3, 20, 20]} /><meshStandardMaterial color={c} wireframe /></mesh>
        </group>
      );
    }
    if (id === 'bear') {
      return (
        <group position={[0, 0.42, 0]} scale={0.72}>
          <RoundedBox args={[0.7, 0.8, 0.6]} radius={0.26} smoothness={4} castShadow><meshStandardMaterial color="#1f1416" roughness={0.9} /></RoundedBox>
          {[-0.2, 0.2].map((x) => (
            <mesh key={x} position={[x, 0.5, 0]}><sphereGeometry args={[0.12, 12, 12]} /><meshStandardMaterial color="#1f1416" roughness={0.9} /></mesh>
          ))}
          {[-0.1, 0.1].map((x) => (
            <mesh key={x} position={[x, 0.1, 0.3]}><sphereGeometry args={[0.03, 8, 8]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={1.6} toneMapped={false} /></mesh>
          ))}
        </group>
      );
    }
    if (id === 'quality') {
      return (
        <group position={[0, 0, 0]}>
          {[0.35, 0.8, 1.25].map((y) => (
            <mesh key={y} position={[0, y, 0]} castShadow><boxGeometry args={[1.15, 0.08, 0.34]} /><meshStandardMaterial color="#3d3128" roughness={0.85} /></mesh>
          ))}
          {Array.from({ length: 5 }).map((_, i) => (
            <mesh key={i} position={[-0.4 + i * 0.2, 0.56, 0]}><boxGeometry args={[0.12, 0.3, 0.28]} /><meshStandardMaterial color={new THREE.Color().setHSL((i * 0.14 + 0.06) % 1, 0.25, 0.36)} roughness={0.75} /></mesh>
          ))}
        </group>
      );
    }
    // sizing — balance scale
    return (
      <group position={[0, 0.55, 0]} scale={0.8}>
        <mesh castShadow><cylinderGeometry args={[0.04, 0.055, 1.1, 10]} /><meshStandardMaterial color="#6f6f78" metalness={0.6} roughness={0.35} /></mesh>
        <mesh ref={spin} position={[0, 0.52, 0]}><boxGeometry args={[1.1, 0.045, 0.045]} /><meshStandardMaterial color="#83838d" metalness={0.6} roughness={0.3} /></mesh>
        {[-0.5, 0.5].map((x, i) => (
          <mesh key={x} position={[x, 0.32 + (i ? 0.04 : -0.04), 0]}><cylinderGeometry args={[0.16, 0.11, 0.1, 16]} /><meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.3} metalness={0.2} roughness={0.5} /></mesh>
        ))}
      </group>
    );
  })();

  return <group position={[-1.72, 0, -1.72]} rotation={[0, Math.PI / 4, 0]}>{inner}</group>;
}

/* -------------------------------------------------------------- room shell */
function RoomCell({ agent, index, focused, dim, hovered, onSelect, onHover }) {
  const p = roomPos(index);
  const grp = useRef();
  const trim = useRef();
  const line = useRef();
  const c = useMemo(() => new THREE.Color(agent.color), [agent.color]);

  useFrame((s, dt) => {
    if (grp.current) {
      const lift = focused ? 0.16 : hovered ? 0.07 : 0;
      grp.current.position.y = damp(grp.current.position.y, lift, 8, dt);
    }
    const em = focused ? 2.4 : dim ? 0.15 : 0.7;
    if (trim.current) trim.current.material.emissiveIntensity = damp(trim.current.material.emissiveIntensity, em, 6, dt);
    if (line.current) line.current.material.emissiveIntensity = damp(line.current.material.emissiveIntensity, em * 0.8, 6, dt);
  });

  const S = 4.6;
  return (
    <group
      ref={grp}
      position={p}
      onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}
      onPointerOver={(e) => { e.stopPropagation(); onHover(agent.id); document.body.style.cursor = 'pointer'; }}
      onPointerOut={() => { onHover(null); document.body.style.cursor = 'default'; }}
    >
      {/* floor slab — near black */}
      <RoundedBox args={[S, 0.3, S]} radius={0.1} smoothness={4} position={[0, -0.15, 0]} receiveShadow>
        <meshStandardMaterial color={dim ? '#0b0b0d' : '#141417'} metalness={0.15} roughness={0.8} />
      </RoundedBox>
      {/* glowing floor trim */}
      <mesh ref={trim} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
        <ringGeometry args={[S / 2 - 0.16, S / 2 - 0.06, 4, 1]} />
        <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.7} toneMapped={false} />
      </mesh>
      {/* back + left walls, dark */}
      <mesh position={[0, 1.05, -S / 2]} receiveShadow>
        <boxGeometry args={[S, 2.5, 0.08]} />
        <meshStandardMaterial color="#0c0c0f" metalness={0.1} roughness={0.9} transparent opacity={dim ? 0.35 : 1} />
      </mesh>
      <mesh position={[-S / 2, 1.05, 0]} receiveShadow>
        <boxGeometry args={[0.08, 2.5, S]} />
        <meshStandardMaterial color="#0a0a0d" metalness={0.1} roughness={0.9} transparent opacity={dim ? 0.28 : 0.92} />
      </mesh>
      {/* accent light line along the back wall */}
      <mesh ref={line} position={[0, 1.7, -S / 2 + 0.06]}>
        <boxGeometry args={[S - 0.5, 0.035, 0.02]} />
        <meshStandardMaterial color={c} emissive={c} emissiveIntensity={0.6} toneMapped={false} />
      </mesh>
      {/* corner posts */}
      {[[-S / 2, -S / 2], [S / 2, -S / 2], [-S / 2, S / 2]].map(([x, z], i) => (
        <mesh key={i} position={[x, 1.05, z]}>
          <boxGeometry args={[0.07, 2.5, 0.07]} />
          <meshStandardMaterial color="#232329" metalness={0.5} roughness={0.5} />
        </mesh>
      ))}

      <group visible={!dim}>
        <Prop id={agent.id} color={agent.color} />
      </group>
      <Bot color={agent.color} focused={focused} />

      {/* one soft accent light, subtle */}
      <pointLight position={[0.6, 1.8, 0.8]} distance={5} intensity={focused ? 2.4 : dim ? 0.2 : 0.55} color={c} />
    </group>
  );
}

/* ------------------------------------------------------------------ motes */
function Motes() {
  const ref = useRef();
  const geo = useMemo(() => {
    const n = 90;
    const arr = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 24;
      arr[i * 3 + 1] = Math.random() * 7;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    return g;
  }, []);
  useFrame((s) => { if (ref.current) ref.current.rotation.y = s.clock.elapsedTime * 0.015; });
  return (
    <points ref={ref} geometry={geo}>
      <pointsMaterial size={0.025} color="#9a9aa8" transparent opacity={0.35} sizeAttenuation />
    </points>
  );
}

/* -------------------------------------------------------------------- rig */
function Rig({ focusIndex }) {
  const { camera } = useThree();
  const tgt = useRef(new THREE.Vector3(0, 0.6, 0));
  const aim = useRef(new THREE.Vector3());
  const pos = useRef(new THREE.Vector3());

  useFrame((s, dt) => {
    const t = s.clock.elapsedTime;
    const focused = focusIndex != null;
    const fp = focused ? roomPos(focusIndex) : new THREE.Vector3(0, 0, 0);
    aim.current.set(fp.x + (focused ? 0.2 : 0), focused ? 0.95 : 0.7, fp.z + (focused ? 0.2 : 0));
    pos.current.copy(aim.current).addScaledVector(ISO, focused ? 15 : 30);
    pos.current.x += Math.sin(t * 0.16) * (focused ? 0.2 : 0.6);
    pos.current.y += Math.sin(t * 0.12) * 0.2;

    camera.position.x = damp(camera.position.x, pos.current.x, 3.2, dt);
    camera.position.y = damp(camera.position.y, pos.current.y, 3.2, dt);
    camera.position.z = damp(camera.position.z, pos.current.z, 3.2, dt);
    tgt.current.x = damp(tgt.current.x, aim.current.x, 3.6, dt);
    tgt.current.y = damp(tgt.current.y, aim.current.y, 3.6, dt);
    tgt.current.z = damp(tgt.current.z, aim.current.z, 3.6, dt);
    camera.lookAt(tgt.current);

    camera.zoom = damp(camera.zoom, focused ? 92 : 44, 3.2, dt);
    camera.updateProjectionMatrix();
  });
  return null;
}

function Effects() {
  return (
    <EffectComposer disableNormalPass multisampling={0}>
      <Bloom mipmapBlur luminanceThreshold={0.7} luminanceSmoothing={0.25} intensity={0.5} radius={0.55} />
      <Vignette eskil={false} offset={0.28} darkness={0.72} />
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
      <fog attach="fog" args={['#070709', 24, 52]} />
      <ambientLight intensity={0.45} />
      <directionalLight
        position={[7, 13, 5]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-bias={-0.0004}
        shadow-camera-left={-18}
        shadow-camera-right={18}
        shadow-camera-top={18}
        shadow-camera-bottom={-18}
      />
      <directionalLight position={[-9, 5, -7]} intensity={0.4} color="#7c88ff" />

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

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.32, 0]} onClick={() => setSel(null)}>
        <planeGeometry args={[80, 80]} />
        <MeshReflectorMaterial
          resolution={256}
          mirror={0.28}
          mixBlur={12}
          mixStrength={0.7}
          blur={[140, 50]}
          roughness={0.96}
          depthScale={0.5}
          color="#080809"
          metalness={0.3}
        />
      </mesh>
      <ContactShadows position={[0, -0.3, 0]} opacity={0.5} scale={30} blur={2.6} far={5} />

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
            camera={{ position: [30, 34, 30], zoom: 44, near: 0.1, far: 240 }}
            onPointerMissed={() => setSel(null)}
          >
            <Scene agents={agents} sel={sel} setSel={setSel} />
          </Canvas>
        </div>

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
