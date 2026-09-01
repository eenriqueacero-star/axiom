import { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { RoundedBox } from '@react-three/drei';
import * as THREE from 'three';
import { getFloor } from '../api';
import { AgentPanel, AgentChat } from './floor/shared';

// ---- layout -------------------------------------------------------------
const GAP = 7;
const roomPos = (i) => {
  const col = i % 3;
  const row = Math.floor(i / 3);
  return new THREE.Vector3(col * GAP, 0, row * GAP);
};
const GRID_CENTER = new THREE.Vector3(GAP, 0, GAP / 2);
const ISO_DIR = new THREE.Vector3(1, 0.9, 1).normalize();

// ---- a tinted low-poly robot -----------------------------------------------
function Robot({ color, wave }) {
  const g = useRef();
  const arm = useRef();
  const t0 = useMemo(() => Math.random() * 10, []);
  useFrame((s) => {
    const t = s.clock.elapsedTime + t0;
    if (g.current) {
      g.current.position.y = 0.9 + Math.sin(t * 1.6) * 0.04;
      g.current.rotation.y = Math.sin(t * 0.4) * 0.15;
    }
    if (arm.current) {
      arm.current.rotation.z = wave
        ? -0.6 + Math.sin(t * 12) * 0.5
        : THREE.MathUtils.lerp(arm.current.rotation.z, 0.15, 0.1);
    }
  });
  const body = new THREE.Color(color);
  const dark = body.clone().multiplyScalar(0.55);
  return (
    <group ref={g} position={[0, 0.9, 0]}>
      <RoundedBox args={[0.7, 0.8, 0.5]} radius={0.12} smoothness={3}>
        <meshStandardMaterial color={body} metalness={0.3} roughness={0.4} />
      </RoundedBox>
      <RoundedBox args={[0.55, 0.45, 0.45]} radius={0.14} smoothness={3} position={[0, 0.68, 0]}>
        <meshStandardMaterial color={body} metalness={0.3} roughness={0.4} />
      </RoundedBox>
      {/* visor */}
      <mesh position={[0, 0.7, 0.24]}>
        <boxGeometry args={[0.4, 0.16, 0.05]} />
        <meshStandardMaterial color="#0a0a0b" emissive={body} emissiveIntensity={0.6} />
      </mesh>
      {/* arms */}
      <group ref={arm} position={[0.42, 0.15, 0]}>
        <mesh position={[0.1, -0.2, 0]}>
          <capsuleGeometry args={[0.09, 0.4, 4, 8]} />
          <meshStandardMaterial color={dark} />
        </mesh>
      </group>
      <mesh position={[-0.52, -0.05, 0]}>
        <capsuleGeometry args={[0.09, 0.4, 4, 8]} />
        <meshStandardMaterial color={dark} />
      </mesh>
      {/* legs */}
      <mesh position={[0.18, -0.7, 0]}>
        <capsuleGeometry args={[0.11, 0.35, 4, 8]} />
        <meshStandardMaterial color={dark} />
      </mesh>
      <mesh position={[-0.18, -0.7, 0]}>
        <capsuleGeometry args={[0.11, 0.35, 4, 8]} />
        <meshStandardMaterial color={dark} />
      </mesh>
    </group>
  );
}

// ---- per-agent room props ------------------------------------------------
function Prop({ id, color }) {
  const spin = useRef();
  useFrame((s, d) => { if (spin.current) spin.current.rotation.y += d * 0.4; });
  const c = new THREE.Color(color);

  if (id === 'trend') {
    // wall of chart monitors
    return (
      <group position={[-1.7, 1.4, -1.7]}>
        {[0, 1, 2, 3].map((i) => (
          <mesh key={i} position={[(i % 2) * 0.95, Math.floor(i / 2) * 0.75, 0]}>
            <boxGeometry args={[0.8, 0.6, 0.06]} />
            <meshStandardMaterial color="#0a0a0b" emissive={c} emissiveIntensity={0.5} />
          </mesh>
        ))}
      </group>
    );
  }
  if (id === 'catalyst') {
    // rocket
    return (
      <group position={[-1.5, 0.9, -1.4]} rotation={[0, 0, 0.12]}>
        <mesh position={[0, 0.6, 0]}>
          <coneGeometry args={[0.28, 0.6, 16]} />
          <meshStandardMaterial color={c} metalness={0.4} roughness={0.3} />
        </mesh>
        <mesh>
          <cylinderGeometry args={[0.28, 0.28, 0.9, 16]} />
          <meshStandardMaterial color="#e5e7eb" metalness={0.3} roughness={0.4} />
        </mesh>
        <mesh position={[0, -0.62, 0]}>
          <coneGeometry args={[0.14, 0.3, 12]} />
          <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={0.8} />
        </mesh>
      </group>
    );
  }
  if (id === 'sector') {
    // spinning wireframe globe
    return (
      <group position={[-1.4, 1.1, -1.4]}>
        <mesh ref={spin}>
          <sphereGeometry args={[0.55, 20, 20]} />
          <meshBasicMaterial color={c} wireframe />
        </mesh>
      </group>
    );
  }
  if (id === 'bear') {
    // dark bear blob
    return (
      <group position={[-1.4, 0.6, -1.3]}>
        <RoundedBox args={[0.9, 1, 0.8]} radius={0.3} smoothness={3}>
          <meshStandardMaterial color="#3f1d1d" roughness={0.9} />
        </RoundedBox>
        <mesh position={[-0.25, 0.6, 0]}><sphereGeometry args={[0.16, 10, 10]} /><meshStandardMaterial color="#3f1d1d" /></mesh>
        <mesh position={[0.25, 0.6, 0]}><sphereGeometry args={[0.16, 10, 10]} /><meshStandardMaterial color="#3f1d1d" /></mesh>
      </group>
    );
  }
  if (id === 'quality') {
    // bookshelves + plant
    return (
      <group position={[-1.8, 0, -1.7]}>
        {[0.4, 0.95, 1.5].map((y) => (
          <mesh key={y} position={[0, y, 0]}>
            <boxGeometry args={[1.4, 0.12, 0.5]} />
            <meshStandardMaterial color="#5b4636" roughness={0.8} />
          </mesh>
        ))}
        {[0, 1, 2, 3, 4].map((i) => (
          <mesh key={i} position={[-0.5 + i * 0.25, 0.6, 0]}>
            <boxGeometry args={[0.16, 0.34, 0.4]} />
            <meshStandardMaterial color={new THREE.Color().setHSL((i * 0.17) % 1, 0.4, 0.5)} />
          </mesh>
        ))}
        <group position={[1.9, 0.4, 0.4]}>
          <mesh><cylinderGeometry args={[0.16, 0.2, 0.4, 8]} /><meshStandardMaterial color="#7c5b3f" /></mesh>
          <mesh position={[0, 0.4, 0]}><icosahedronGeometry args={[0.32, 0]} /><meshStandardMaterial color="#22c55e" flatShading /></mesh>
        </group>
      </group>
    );
  }
  // sizing — balance scale
  return (
    <group position={[-1.4, 0.8, -1.3]}>
      <mesh><cylinderGeometry args={[0.05, 0.05, 1.4, 8]} /><meshStandardMaterial color="#9ca3af" metalness={0.6} /></mesh>
      <mesh ref={spin} position={[0, 0.7, 0]}>
        <boxGeometry args={[1.5, 0.06, 0.06]} />
        <meshStandardMaterial color="#9ca3af" metalness={0.6} />
      </mesh>
      {[-0.7, 0.7].map((x) => (
        <mesh key={x} position={[x, 0.45, 0]}>
          <cylinderGeometry args={[0.22, 0.16, 0.14, 12]} />
          <meshStandardMaterial color={c} metalness={0.3} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function Room({ agent, index, focused, dim, onSelect }) {
  const p = roomPos(index);
  const c = new THREE.Color(agent.color);
  return (
    <group
      position={p}
      onClick={(e) => { e.stopPropagation(); onSelect(agent.id); }}
      onPointerOver={() => (document.body.style.cursor = 'pointer')}
      onPointerOut={() => (document.body.style.cursor = 'default')}
    >
      {/* floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[4.6, 4.6]} />
        <meshStandardMaterial color={dim ? '#141416' : '#1c1c20'} />
      </mesh>
      {/* floor edge glow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <ringGeometry args={[3.15, 3.25, 4]} />
        <meshBasicMaterial color={c} transparent opacity={focused ? 0.9 : 0.25} />
      </mesh>
      {/* two back walls (L, open front) */}
      <mesh position={[0, 1.5, -2.3]}>
        <boxGeometry args={[4.6, 3, 0.12]} />
        <meshStandardMaterial color="#0f0f11" transparent opacity={dim ? 0.35 : 0.9} />
      </mesh>
      <mesh position={[-2.3, 1.5, 0]}>
        <boxGeometry args={[0.12, 3, 4.6]} />
        <meshStandardMaterial color="#101013" transparent opacity={dim ? 0.35 : 0.9} />
      </mesh>
      <Prop id={agent.id} color={agent.color} />
      <Robot color={agent.color} wave={focused} />
      <pointLight position={[0, 2.4, 0]} distance={6} intensity={focused ? 6 : 2.2} color={c} />
    </group>
  );
}

function Rig({ focusIndex }) {
  const { camera } = useThree();
  const target = useRef(GRID_CENTER.clone());
  const desiredPos = useRef(new THREE.Vector3());
  useFrame(() => {
    const focusPt = focusIndex == null ? GRID_CENTER : roomPos(focusIndex);
    const dist = focusIndex == null ? 26 : 13;
    desiredPos.current.copy(focusPt).addScaledVector(ISO_DIR, dist);
    camera.position.lerp(desiredPos.current, 0.08);
    target.current.lerp(focusPt, 0.08);
    camera.lookAt(target.current);
    const wantZoom = focusIndex == null ? 34 : 62;
    camera.zoom += (wantZoom - camera.zoom) * 0.08;
    camera.updateProjectionMatrix();
  });
  return null;
}

export default function Floor3D({ onAnalyze, onExit }) {
  const [floor, setFloor] = useState(null);
  const [err, setErr] = useState('');
  const [sel, setSel] = useState(null);

  useEffect(() => { getFloor().then(setFloor).catch((e) => setErr(e.message)); }, []);

  if (err) return <p className="text-xs text-red-400">{err}</p>;
  if (!floor) return <p className="text-xs text-haze animate-pulse">Loading the floor…</p>;

  const agents = floor.agents;
  const selIndex = sel == null ? null : agents.findIndex((a) => a.id === sel);
  const selAgent = sel == null ? null : agents.find((a) => a.id === sel);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-sm text-neutral-200">The Floor</h1>
          <p className="text-[11px] text-haze">
            {sel ? 'Tap the room floor or “back” to step out.' : 'Tap a room to visit an analyst.'}
          </p>
        </div>
        <button onClick={onExit} className="text-[11px] text-haze hover:text-neutral-300 shrink-0">
          cards view
        </button>
      </div>

      <div className="relative">
        <div className="rounded-xl overflow-hidden border border-ink-800 bg-ink-950" style={{ height: 'min(62vh, 460px)' }}>
          <Canvas
            dpr={[1, 1.75]}
            orthographic
            camera={{ position: [26, 24, 26], zoom: 34, near: 0.1, far: 200 }}
            onPointerMissed={() => setSel(null)}
          >
            <color attach="background" args={['#0a0a0b']} />
            <ambientLight intensity={0.5} />
            <directionalLight position={[10, 18, 8]} intensity={0.8} />
            <Suspense fallback={null}>
              {agents.map((a, i) => (
                <Room
                  key={a.id}
                  agent={a}
                  index={i}
                  focused={sel === a.id}
                  dim={sel != null && sel !== a.id}
                  onSelect={setSel}
                />
              ))}
            </Suspense>
            <Rig focusIndex={selIndex} />
          </Canvas>
        </div>

        {/* side nav */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => setSel(a.id)}
              className={`text-left text-[11px] font-mono tracking-wider px-2 py-1 rounded transition-colors ${
                sel === a.id ? 'bg-ink-800 text-neutral-100' : 'bg-ink-950/70 text-haze hover:text-neutral-300'
              }`}
              style={sel === a.id ? { color: a.color } : undefined}
            >
              {a.emoji} {a.name}
            </button>
          ))}
        </div>
      </div>

      {selAgent && (
        <div className="card p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="font-mono text-xs tracking-wider" style={{ color: selAgent.color }}>
              {selAgent.emoji} {selAgent.name}
            </span>
            <button onClick={() => setSel(null)} className="text-[11px] text-haze hover:text-neutral-300">back</button>
          </div>
          <p className="text-[11px] uppercase tracking-wide text-haze">{selAgent.role}</p>
          <AgentPanel agent={selAgent} data={floor.perAgent[selAgent.id]} onAnalyze={onAnalyze} />
          <AgentChat agent={selAgent} />
        </div>
      )}
    </div>
  );
}
