import React, { useState, useEffect, useContext, createContext, Component, useRef, useMemo, memo } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { AgentConfig, AgentWorkspaceProps, BrandingConfig, RoomType } from './types';

// ─── Context for passing config down to sub-components ──────────────────────
const WorkspaceContext = createContext<{
  agents: AgentConfig[];
  rooms: RoomType[];
  branding: BrandingConfig;
  isPro: boolean;
  onAgentClick?: AgentWorkspaceProps['onAgentClick'];
}>({
  agents: [],
  rooms: ['office'],
  branding: { name: 'Agent HQ' },
  isPro: false,
});

class CanvasErrorBoundary extends Component<{children: ReactNode}, {hasError: boolean, error: string}> {
  state = { hasError: false, error: '' };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message + '\n' + error.stack };
  }
  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Canvas Error:', error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      return (
        <Html center>
          <div style={{ background: 'black', color: 'red', padding: 20, width: 800 }}>
            <h2>Canvas Crashed!</h2>
            <pre style={{ whiteSpace: 'pre-wrap', fontSize: 10 }}>{this.state.error}</pre>
          </div>
        </Html>
      );
    }
    return this.props.children;
  }
}

// ─── Default agent roster (used when no agents prop is provided) ─────────────
const DESK_POSITIONS: [number,number,number][] = [
  [-5.0, 0, -3.6], [-1.6, 0, 1.2], [2.0, 0, 1.2], [5.0, 0, 1.2],
  [-1.6, 0, -1.6], [2.0, 0, -1.6], [5.0, 0, -1.6], [0.2, 0, -4.0],
  [-5.0, 0, 1.2], [5.0, 0, -3.6], [-3.0, 0, 3.0], [3.0, 0, 3.0],
];
const SKIN_COLORS = ['#c8956c', '#e2c898', '#fbbf24', '#d4b499', '#c8a882', '#e4c09a', '#dbb896', '#c49a6c'];

function buildAgentList(configs: AgentConfig[]) {
  return configs.map((c, i) => ({
    id: c.id ?? i,
    name: c.name,
    color: c.color,
    skinColor: c.skinColor || SKIN_COLORS[i % SKIN_COLORS.length],
    status: c.status || 'active',
    role: c.role,
    desk: c.deskPosition || DESK_POSITIONS[i % DESK_POSITIONS.length],
    isBoss: c.isBoss ?? (i === 0),
    accessory: c.accessory,
  }));
}

const DEFAULT_AGENTS: AgentConfig[] = [
  { name: 'Kingpin', color: '#d4af37', role: 'CEO', isBoss: true, accessory: 'sunglasses' },
  { name: 'JARVIS', color: '#3b82f6', role: 'AI Core', accessory: 'visor' },
  { name: 'Zurie', color: '#a855f7', role: 'Outreach', accessory: 'headset' },
  { name: 'Intake', color: '#10b981', role: 'Processing' },
  { name: 'Broker', color: '#f59e0b', role: 'Deals' },
  { name: 'Scout', color: '#ef4444', role: 'Prospecting', status: 'busy', accessory: 'cap' },
  { name: 'Underwriter', color: '#06b6d4', role: 'Risk' },
  { name: 'Closer', color: '#ec4899', role: 'Funding', accessory: 'bowtie' },
];

// Waypoints for multi-room office (all rooms)
const WAYPOINTS: [number,number,number][] = [
  // Main office
  [0,0,0], [1.6,0,0.6], [-1.6,0,0.6], [0,0,-1.6], [2.4,0,-0.6],
  [-2.0,0,-1.6], [1.2,0,-2.4], [0,0,1.0], [2.0,0,1.2], [-2.4,0,0.6],
  [3.0,0,0], [-3.0,0,0], [0,0,-3.0], [2.4,0,-1.8], [-1.6,0,-3.0],
  // Gym doorway + room
  [-10,0,0], [-12,0,0], [-16,0,0], [-19,0,0], [-22,0,0],
  [-19,0,-4], [-19,0,3], [-16,0,-4], [-22,0,3], [-15,0,1],
  // Break room doorway + room
  [10,0,0], [12,0,0], [16,0,0], [19,0,0], [22,0,0],
  [19,0,-4], [19,0,3], [16,0,4], [22,0,4], [17,0,1],
  // Boardroom (behind main office, right side)
  [7,0,-8], [7,0,-11], [5,0,-11], [9,0,-11], [7,0,-13],
  // Server room (behind main office, left side)
  [-4,0,-8], [-4,0,-11], [-6,0,-11], [-2,0,-11], [-4,0,-13],
  // Rooftop lounge (elevated)
  [0,2.2,10], [4,2.2,10], [-4,2.2,10], [0,2.2,12], [6,2.2,11],
];

// ─── Multi-room floor system ─────────────────────────────────────────────────
const ExpandedFloor = memo(() => {
  const officeFloor = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1a1a2e', roughness: 0.3, metalness: 0.1 }), []);
  const gymFloor = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1a1a1a', roughness: 0.9, metalness: 0.0 }), []);
  const breakFloor = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a1a0a', roughness: 0.5, metalness: 0.05 }), []);
  const goldMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d4af37', emissive: new THREE.Color('#b8941e'), emissiveIntensity: 0.3, roughness: 0.2, metalness: 0.8 }), []);
  const gridMaterial = useMemo(() => new THREE.MeshStandardMaterial({ color: '#2a2a4a', roughness: 0.4, metalness: 0.1 }), []);

  return (
    <group>
      {/* Main office floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[24, 16]} />
        <primitive object={officeFloor} attach="material" />
      </mesh>
      {/* Gym floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-19, -0.02, 0]}>
        <planeGeometry args={[16, 16]} />
        <primitive object={gymFloor} attach="material" />
      </mesh>
      {/* Break room floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[19, -0.02, 0]}>
        <planeGeometry args={[16, 16]} />
        <primitive object={breakFloor} attach="material" />
      </mesh>
      {/* Gold inlay in main office */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.015, 0]}>
        <ringGeometry args={[7.0, 7.2, 32]} />
        <primitive object={goldMaterial} attach="material" />
      </mesh>
      {/* Center logo */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[1.5, 32]} />
        <meshStandardMaterial color="#0055ff" transparent opacity={0.3} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.009, 0]}>
        <ringGeometry args={[1.3, 1.5, 32]} />
        <meshStandardMaterial color="#aaff00" emissive="#55cc00" emissiveIntensity={0.6} />
      </mesh>
      {/* Grid lines — main office */}
      {[-8,-6,-4,-2,0,2,4,6,8].map((x, i) => (
        <mesh key={`vl${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[x, -0.008, 0]}>
          <planeGeometry args={[0.01, 16]} />
          <primitive object={gridMaterial} attach="material" />
        </mesh>
      ))}
      {[-6,-4,-2,0,2,4,6].map((z, i) => (
        <mesh key={`hl${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.008, z]}>
          <planeGeometry args={[24, 0.01]} />
          <primitive object={gridMaterial} attach="material" />
        </mesh>
      ))}
      {/* Gym rubber floor lines */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-19, -0.015, 0]}>
        <ringGeometry args={[4.0, 4.1, 32]} />
        <meshStandardMaterial color="#333333" roughness={0.8} />
      </mesh>
      {/* Break room floor accent */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[19, -0.015, 0]}>
        <ringGeometry args={[3.5, 3.6, 32]} />
        <meshStandardMaterial color="#3a2a1a" roughness={0.5} />
      </mesh>
    </group>
  );
});

// ─── Multi-room walls with doorways ──────────────────────────────────────────
const ExpandedWalls = memo(() => {
  const dark = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0f0f23', roughness: 0.7, metalness: 0.0 }), []);
  const gold = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d4af37', emissive: new THREE.Color('#b8941e'), emissiveIntensity: 0.4, roughness: 0.15, metalness: 0.9 }), []);
  const glass = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1e3a5f', transparent: true, opacity: 0.3, roughness: 0.05, metalness: 0.1 }), []);
  const partition = useMemo(() => new THREE.MeshStandardMaterial({ color: '#3b82f6', transparent: true, opacity: 0.15, roughness: 0.1 }), []);
  const gymWall = useMemo(() => new THREE.MeshStandardMaterial({ color: '#121218', roughness: 0.8, metalness: 0.0 }), []);
  const breakWall = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1a1008', roughness: 0.6, metalness: 0.0 }), []);

  return (
    <group>
      {/* ═══ MAIN OFFICE WALLS ═══ */}
      {/* Back wall — split into 3 segments with 2 doorways */}
      {/* Left segment (X: -11 to -5) */}
      <mesh position={[-8, 0.9, -7.0]}><boxGeometry args={[6, 2, 0.08]} /><primitive object={dark} attach="material" /></mesh>
      {/* Middle segment (X: -3 to 6) */}
      <mesh position={[1.5, 0.9, -7.0]}><boxGeometry args={[9, 2, 0.08]} /><primitive object={dark} attach="material" /></mesh>
      {/* Right segment (X: 8 to 11) */}
      <mesh position={[9.5, 0.9, -7.0]}><boxGeometry args={[3, 2, 0.08]} /><primitive object={dark} attach="material" /></mesh>
      {/* Gold accent across top */}
      <mesh position={[0, 1.85, -7.0]}><boxGeometry args={[24, 0.04, 0.09]} /><primitive object={gold} attach="material" /></mesh>
      {/* Door frames for back doorways */}
      {/* Server room door (X=-4) */}
      <mesh position={[-5, 1.9, -7.0]}><boxGeometry args={[0.1, 0.2, 2.2]} /><primitive object={gold} attach="material" /></mesh>
      <mesh position={[-5, 0.9, -7.0]}><boxGeometry args={[0.1, 2, 0.1]} /><primitive object={gold} attach="material" /></mesh>
      <mesh position={[-3, 0.9, -7.0]}><boxGeometry args={[0.1, 2, 0.1]} /><primitive object={gold} attach="material" /></mesh>
      {/* Boardroom door (X=7) */}
      <mesh position={[7, 1.9, -7.0]}><boxGeometry args={[0.1, 0.2, 2.2]} /><primitive object={gold} attach="material" /></mesh>
      <mesh position={[6, 0.9, -7.0]}><boxGeometry args={[0.1, 2, 0.1]} /><primitive object={gold} attach="material" /></mesh>
      <mesh position={[8, 0.9, -7.0]}><boxGeometry args={[0.1, 2, 0.1]} /><primitive object={gold} attach="material" /></mesh>
      {/* Door signs */}
      <Html position={[-4, 2.15, -7.0]} center distanceFactor={6} zIndexRange={[10,0]}>
        <div style={{ color: '#06b6d4', fontSize: 10, fontWeight: 900, fontFamily: 'Inter, sans-serif', letterSpacing: '0.15em', pointerEvents: 'none' }}>SERVER ROOM</div>
      </Html>
      <Html position={[7, 2.15, -7.0]} center distanceFactor={6} zIndexRange={[10,0]}>
        <div style={{ color: '#d4af37', fontSize: 10, fontWeight: 900, fontFamily: 'Inter, sans-serif', letterSpacing: '0.15em', pointerEvents: 'none' }}>BOARDROOM</div>
      </Html>
      {/* Front wall */}
      <mesh position={[0, 0.9, 7.0]}><boxGeometry args={[24, 2, 0.08]} /><primitive object={glass} attach="material" /></mesh>

      {/* Left wall — split for doorway (gap at Z: -1 to +1) */}
      <mesh position={[-11.0, 0.9, -4.5]}><boxGeometry args={[0.08, 2, 5]} /><primitive object={dark} attach="material" /></mesh>
      <mesh position={[-11.0, 0.9, 4.5]}><boxGeometry args={[0.08, 2, 5]} /><primitive object={dark} attach="material" /></mesh>
      {/* Door frame */}
      <mesh position={[-11.0, 1.9, 0]}><boxGeometry args={[0.12, 0.2, 2.2]} /><primitive object={gold} attach="material" /></mesh>
      <mesh position={[-11.0, 0.9, -1.1]}><boxGeometry args={[0.12, 2, 0.1]} /><primitive object={gold} attach="material" /></mesh>
      <mesh position={[-11.0, 0.9, 1.1]}><boxGeometry args={[0.12, 2, 0.1]} /><primitive object={gold} attach="material" /></mesh>

      {/* Right wall — split for doorway */}
      <mesh position={[11.0, 0.9, -4.5]}><boxGeometry args={[0.08, 2, 5]} /><primitive object={dark} attach="material" /></mesh>
      <mesh position={[11.0, 0.9, 4.5]}><boxGeometry args={[0.08, 2, 5]} /><primitive object={dark} attach="material" /></mesh>
      {/* Door frame */}
      <mesh position={[11.0, 1.9, 0]}><boxGeometry args={[0.12, 0.2, 2.2]} /><primitive object={gold} attach="material" /></mesh>
      <mesh position={[11.0, 0.9, -1.1]}><boxGeometry args={[0.12, 2, 0.1]} /><primitive object={gold} attach="material" /></mesh>
      <mesh position={[11.0, 0.9, 1.1]}><boxGeometry args={[0.12, 2, 0.1]} /><primitive object={gold} attach="material" /></mesh>

      {/* Glass partition for Kingpin's office */}
      <mesh position={[-3.0, 0.7, -2.4]}><boxGeometry args={[0.04, 1.4, 3.6]} /><primitive object={partition} attach="material" /></mesh>

      {/* ═══ GYM ROOM WALLS ═══ */}
      <mesh position={[-19, 0.9, -7.0]}><boxGeometry args={[16, 2, 0.08]} /><primitive object={gymWall} attach="material" /></mesh>
      <mesh position={[-19, 0.9, 7.0]}><boxGeometry args={[16, 2, 0.08]} /><primitive object={gymWall} attach="material" /></mesh>
      <mesh position={[-27, 0.9, 0]}><boxGeometry args={[0.08, 2, 14]} /><primitive object={gymWall} attach="material" /></mesh>
      {/* Gold accents */}
      <mesh position={[-19, 1.85, -7.0]}><boxGeometry args={[16, 0.04, 0.09]} /><primitive object={gold} attach="material" /></mesh>
      <mesh position={[-19, 1.85, 7.0]}><boxGeometry args={[16, 0.04, 0.09]} /><primitive object={gold} attach="material" /></mesh>

      {/* ═══ BREAK ROOM WALLS ═══ */}
      <mesh position={[19, 0.9, -7.0]}><boxGeometry args={[16, 2, 0.08]} /><primitive object={breakWall} attach="material" /></mesh>
      <mesh position={[19, 0.9, 7.0]}><boxGeometry args={[16, 2, 0.08]} /><primitive object={breakWall} attach="material" /></mesh>
      <mesh position={[27, 0.9, 0]}><boxGeometry args={[0.08, 2, 14]} /><primitive object={breakWall} attach="material" /></mesh>
      {/* Gold accents */}
      <mesh position={[19, 1.85, -7.0]}><boxGeometry args={[16, 0.04, 0.09]} /><primitive object={gold} attach="material" /></mesh>
      <mesh position={[19, 1.85, 7.0]}><boxGeometry args={[16, 0.04, 0.09]} /><primitive object={gold} attach="material" /></mesh>

      {/* ═══ ROOM SIGNS ═══ */}
      {/* Gym sign */}
      <mesh position={[-11.0, 2.15, 0]}><boxGeometry args={[0.06, 0.25, 1.8]} /><primitive object={dark} attach="material" /></mesh>
      <Html position={[-11.0, 2.15, 0]} center distanceFactor={6} zIndexRange={[10,0]}>
        <div style={{ color: '#d4af37', fontSize: 14, fontWeight: 900, fontFamily: 'Inter, sans-serif', letterSpacing: '0.2em', pointerEvents: 'none' }}>
          GYM
        </div>
      </Html>
      {/* Break room sign */}
      <mesh position={[11.0, 2.15, 0]}><boxGeometry args={[0.06, 0.25, 1.8]} /><primitive object={dark} attach="material" /></mesh>
      <Html position={[11.0, 2.15, 0]} center distanceFactor={6} zIndexRange={[10,0]}>
        <div style={{ color: '#d4af37', fontSize: 14, fontWeight: 900, fontFamily: 'Inter, sans-serif', letterSpacing: '0.2em', pointerEvents: 'none' }}>
          BREAK ROOM
        </div>
      </Html>
    </group>
  );
});

// ─── Executive desk (Kingpin's) ───────────────────────────────────────────────
const ExecutiveDesk = memo(({ position }: { position: [number, number, number] }) => {
  return (
    <group position={position}>
      {/* Large L-shaped desk */}
      <mesh position={[0, 0.32, 0]} >
        <boxGeometry args={[1.0, 0.05, 0.5]} />
        <meshLambertMaterial color='#1a0a00' />
      </mesh>
      <mesh position={[-0.35, 0.32, -0.35]} >
        <boxGeometry args={[0.3, 0.05, 0.4]} />
        <meshLambertMaterial color='#1a0a00' />
      </mesh>
      {/* Gold edge trim */}
      <mesh position={[0, 0.35, 0.25]}>
        <boxGeometry args={[1.0, 0.015, 0.01]} />
        <meshLambertMaterial color='#d4af37' emissive='#b8941e' emissiveIntensity={0.5} />
      </mesh>
      {/* Desk legs — gold accent */}
      {[[-0.45, 0.2], [0.45, 0.2], [-0.45, -0.2], [0.45, -0.2]].map(([dx, dz], i) => (
        <mesh key={i} position={[dx as number, 0.15, dz as number]}>
          <boxGeometry args={[0.04, 0.32, 0.04]} />
          <meshLambertMaterial color='#d4af37' />
        </mesh>
      ))}
      {/* Dual monitors */}
      <mesh position={[-0.15, 0.48, -0.12]} >
        <boxGeometry args={[0.26, 0.18, 0.02]} />
        <meshLambertMaterial color='#0a0a0a' />
      </mesh>
      <mesh position={[-0.15, 0.48, -0.11]}>
        <boxGeometry args={[0.22, 0.14, 0.005]} />
        <meshLambertMaterial color='#1e40af' emissive='#1e3a8a' emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0.15, 0.48, -0.12]} >
        <boxGeometry args={[0.26, 0.18, 0.02]} />
        <meshLambertMaterial color='#0a0a0a' />
      </mesh>
      <mesh position={[0.15, 0.48, -0.11]}>
        <boxGeometry args={[0.22, 0.14, 0.005]} />
        <meshLambertMaterial color='#10b981' emissive='#047857' emissiveIntensity={0.4} />
      </mesh>
      {/* Executive chair */}
      <mesh position={[0, 0.22, 0.32]} >
        <boxGeometry args={[0.22, 0.04, 0.22]} />
        <meshLambertMaterial color='#1a0a00' />
      </mesh>
      <mesh position={[0, 0.38, 0.42]}>
        <boxGeometry args={[0.22, 0.28, 0.04]} />
        <meshLambertMaterial color='#1a0a00' />
      </mesh>
    </group>
  );
});

// ─── Standard desk ────────────────────────────────────────────────────────────
const Desk = memo(({ position }: { position: [number, number, number] }) => {
  return (
    <group position={position}>
      {/* Desk surface at waist height (0.5) for 1.3-unit character */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[1.0, 0.04, 0.6]} />
        <meshLambertMaterial color='#1c1c2e' />
      </mesh>
      {/* Desk legs */}
      {[[-0.45, -0.25], [0.45, -0.25], [-0.45, 0.25], [0.45, 0.25]].map(([dx, dz], i) => (
        <mesh key={i} position={[dx as number, 0.24, dz as number]}>
          <boxGeometry args={[0.04, 0.5, 0.04]} />
          <meshLambertMaterial color='#2a2a4a' />
        </mesh>
      ))}
      {/* Office chair behind desk */}
      <group position={[0, 0, 0.5]}>
        <mesh position={[0, 0.35, 0]}><boxGeometry args={[0.35, 0.04, 0.35]} /><meshLambertMaterial color='#1a1a2e' /></mesh>
        <mesh position={[0, 0.58, 0.16]}><boxGeometry args={[0.33, 0.42, 0.04]} /><meshLambertMaterial color='#1a1a2e' /></mesh>
        <mesh position={[0, 0.15, 0]}><cylinderGeometry args={[0.02, 0.02, 0.3, 8]} /><meshLambertMaterial color='#2a2a4a' /></mesh>
        <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.15, 0.15, 0.03, 8]} /><meshLambertMaterial color='#2a2a4a' /></mesh>
      </group>
      {/* Monitor */}
      <mesh position={[0, 0.72, -0.15]}>
        <boxGeometry args={[0.4, 0.28, 0.02]} />
        <meshLambertMaterial color='#0a0a0a' />
      </mesh>
      <mesh position={[0, 0.72, -0.14]}>
        <boxGeometry args={[0.36, 0.24, 0.005]} />
        <meshLambertMaterial color='#3b82f6' emissive='#1e40af' emissiveIntensity={0.5} />
      </mesh>
      <mesh position={[0, 0.56, -0.15]}>
        <boxGeometry args={[0.06, 0.08, 0.06]} />
        <meshLambertMaterial color='#0a0a0a' />
      </mesh>
      {/* Keyboard */}
      <mesh position={[0, 0.522, 0.05]}>
        <boxGeometry args={[0.22, 0.01, 0.08]} />
        <meshStandardMaterial color='#1a1a2e' roughness={0.6} />
      </mesh>
      {/* Mouse */}
      <mesh position={[0.2, 0.522, 0.08]}>
        <boxGeometry args={[0.04, 0.015, 0.06]} />
        <meshStandardMaterial color='#1a1a2e' roughness={0.5} />
      </mesh>
      {/* Coffee mug */}
      <group position={[-0.3, 0.52, 0.1]}>
        <mesh position={[0, 0.04, 0]}>
          <cylinderGeometry args={[0.03, 0.03, 0.07, 12]} />
          <meshStandardMaterial color='#f5f5f5' roughness={0.3} />
        </mesh>
        <mesh position={[0.035, 0.03, 0]} rotation={[0, 0, Math.PI / 2]}>
          <torusGeometry args={[0.018, 0.005, 8, 12]} />
          <meshStandardMaterial color='#f5f5f5' roughness={0.3} />
        </mesh>
      </group>
      {/* Desk phone */}
      <mesh position={[0.3, 0.522, -0.1]}>
        <boxGeometry args={[0.1, 0.025, 0.14]} />
        <meshStandardMaterial color='#1a1a2e' roughness={0.4} />
      </mesh>
      {/* Notepad */}
      <mesh position={[-0.2, 0.522, -0.08]}>
        <boxGeometry args={[0.12, 0.004, 0.16]} />
        <meshStandardMaterial color='#fef3c7' roughness={0.9} />
      </mesh>
      {/* Pen */}
      <mesh position={[-0.17, 0.525, -0.08]} rotation={[0, 0.3, Math.PI / 4]}>
        <cylinderGeometry args={[0.003, 0.003, 0.1, 8]} />
        <meshStandardMaterial color='#1e40af' roughness={0.2} metalness={0.6} />
      </mesh>
    </group>
  );
});

// ─── HardLend branding wall ───────────────────────────────────────────────────
const BrandingWall = memo(() => {
  return (
    <group>
      {/* 3D Logo text background panel on back wall */}
      <mesh position={[0, 1.3, -3.44]}>
        <boxGeometry args={[2.0, 0.5, 0.02]} />
        <meshLambertMaterial color='#0a0a1a' />
      </mesh>
      {/* Gold "HL" logo mark */}
      <mesh position={[-0.5, 1.3, -3.43]}>
        <boxGeometry args={[0.12, 0.3, 0.03]} />
        <meshLambertMaterial color='#d4af37' emissive='#b8941e' emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[-0.38, 1.3, -3.43]}>
        <boxGeometry args={[0.12, 0.12, 0.03]} />
        <meshLambertMaterial color='#d4af37' emissive='#b8941e' emissiveIntensity={0.8} />
      </mesh>
      <mesh position={[-0.26, 1.3, -3.43]}>
        <boxGeometry args={[0.04, 0.3, 0.03]} />
        <meshLambertMaterial color='#d4af37' emissive='#b8941e' emissiveIntensity={0.8} />
      </mesh>
      {/* HardLend text overlay */}
      <Html position={[0.25, 1.3, -3.42]} center distanceFactor={5} zIndexRange={[10, 0]}>
        <div style={{
          display: "flex", alignItems: "center", gap: "8px",
          color: '#ffffff', fontSize: 24, fontWeight: 900, letterSpacing: '0.05em',
          fontFamily: 'Inter, sans-serif', textShadow: '0 0 10px rgba(0,255,255,0.5)',
          pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          HARD LEND <span style={{ color: "#aaff00" }}>AI</span>
        </div>
      </Html>
      {/* Tagline */}
      <Html position={[0, 0.98, -3.42]} center distanceFactor={6} zIndexRange={[10, 0]}>
        <div style={{
          color: '#64748b', fontSize: 8, fontWeight: 500, letterSpacing: '0.3em',
          fontFamily: 'Inter, sans-serif', pointerEvents: 'none', whiteSpace: 'nowrap',
        }}>
          GROWTH PLATFORM FOR HARD MONEY LENDERS
        </div>
      </Html>
    </group>
  );
});

// ─── Luxury decorations ───────────────────────────────────────────────────────
const LuxuryDecorations = memo(() => {
  return (
    <group>
      {/* Ceiling lights — more and bigger for larger space */}
      {[-8, -6, -4, -2, 0, 2, 4, 6, 8].map((x, i) => (
        <mesh key={`cl${i}`} position={[x, 1.88, 0]}>
          <boxGeometry args={[0.12, 0.03, 12]} />
          <meshLambertMaterial color='#fef3c7' emissive='#d4af37' emissiveIntensity={0.3} />
        </mesh>
      ))}

      {/* More potted plants for bigger space */}
      {[[9, -5.6], [9, 4.0], [-9.6, 5.0], [-9.6, -5.0], [7, 3], [-7, 3]].map(([x, z], i) => (
        <group key={`pl${i}`} position={[x as number, 0, z as number]}>
          <mesh position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.18, 0.21, 0.6, 12]} />
            <meshLambertMaterial color='#1a1a2e' />
          </mesh>
          <mesh position={[0, 0.75, 0]}>
            <sphereGeometry args={[0.3, 12, 12]} />
            <meshLambertMaterial color='#065f46' />
          </mesh>
        </group>
      ))}

      {/* Server rack — scaled for bigger office */}
      <group position={[9, 0, -5.0]}>
        <mesh position={[0, 0.8, 0]} >
          <boxGeometry args={[0.6, 1.6, 0.8]} />
          <meshLambertMaterial color='#0a0a1a' />
        </mesh>
        {[0, 0.25, 0.5, 0.75, 1.0].map((dy, i) => (
          <mesh key={i} position={[0.31, 0.2 + dy, 0]}>
            <boxGeometry args={[0.02, 0.06, 0.6]} />
            <meshLambertMaterial color='#3b82f6' emissive='#1d4ed8' emissiveIntensity={0.6} />
          </mesh>
        ))}
      </group>

      {/* Wall-mounted TV — bigger for bigger office */}
      <mesh position={[7, 1.4, -6.88]} >
        <boxGeometry args={[2.4, 1.4, 0.05]} />
        <meshLambertMaterial color='#0a0a0a' />
      </mesh>
      <mesh position={[7, 1.4, -6.86]}>
        <boxGeometry args={[2.2, 1.2, 0.01]} />
        <meshLambertMaterial color='#1e3a5f' emissive='#1e40af' emissiveIntensity={0.3} />
      </mesh>
      <Html position={[7, 1.4, -6.84]} center distanceFactor={10} zIndexRange={[5, 0]}>
        <div style={{ color: '#3b82f6', fontSize: 14, fontWeight: 600, fontFamily: 'Inter, sans-serif',
          pointerEvents: 'none', textAlign: 'center', lineHeight: 1.5 }}>
          <div style={{ color: '#d4af37', fontSize: 18, fontWeight: 800 }}>📊 LIVE METRICS</div>
          <div style={{ fontSize: 16 }}>Pipeline: $4.2M</div>
          <div style={{ fontSize: 16 }}>Funded: $12.8M</div>
          <div style={{ color: '#10b981', fontSize: 16 }}>+23% MTD</div>
        </div>
      </Html>

      {/* Conference table — bigger and more realistic */}
      <group position={[7, 0, 3.0]}>
        <mesh position={[0, 0.35, 0]} >
          <cylinderGeometry args={[1.1, 1.1, 0.06, 24]} />
          <meshLambertMaterial color='#1a0a00' />
        </mesh>
        <mesh position={[0, 0.18, 0]}>
          <cylinderGeometry args={[0.08, 0.08, 0.36, 8]} />
          <meshLambertMaterial color='#d4af37' />
        </mesh>
        {/* Conference chairs around table */}
        {[0, 60, 120, 180, 240, 300].map((angle, i) => {
          const rad = (angle * Math.PI) / 180;
          const x = Math.cos(rad) * 1.5;
          const z = Math.sin(rad) * 1.5;
          return (
            <group key={`chair${i}`} position={[x, 0, z]} rotation={[0, -rad, 0]}>
              <mesh position={[0, 0.25, 0]}>
                <boxGeometry args={[0.3, 0.05, 0.3]} />
                <meshLambertMaterial color='#1a1a2e' />
              </mesh>
              <mesh position={[0, 0.45, 0.15]}>
                <boxGeometry args={[0.3, 0.35, 0.05]} />
                <meshLambertMaterial color='#1a1a2e' />
              </mesh>
            </group>
          );
        })}
      </group>

      {/* Kingpin nameplate on executive desk - scaled */}
      <mesh position={[-4.4, 0.36, -3.1]}>
        <boxGeometry args={[0.4, 0.08, 0.06]} />
        <meshLambertMaterial color='#d4af37' emissive='#b8941e' emissiveIntensity={0.5} />
      </mesh>

      {/* Water cooler */}
      <group position={[-7, 0, 4]}>
        <mesh position={[0, 0.5, 0]} >
          <cylinderGeometry args={[0.15, 0.15, 1.0, 12]} />
          <meshLambertMaterial color='#3b82f6' transparent opacity={0.6} />
        </mesh>
        <mesh position={[0, 0.05, 0]}>
          <boxGeometry args={[0.4, 0.1, 0.4]} />
          <meshLambertMaterial color='#1a1a2e' />
        </mesh>
      </group>

      {/* Filing cabinets */}
      {[[-8, -6], [8, -6]].map(([x, z], i) => (
        <group key={`cabinet${i}`} position={[x, 0, z]}>
          <mesh position={[0, 0.5, 0]} >
            <boxGeometry args={[0.5, 1.0, 0.6]} />
            <meshStandardMaterial color='#2a2a4a' roughness={0.6} metalness={0.3} />
          </mesh>
          {[0.3, 0.6].map((dy, j) => (
            <mesh key={j} position={[0.26, dy, 0]}>
              <boxGeometry args={[0.02, 0.08, 0.12]} />
              <meshStandardMaterial color='#6b7280' roughness={0.3} metalness={0.7} />
            </mesh>
          ))}
        </group>
      ))}

      {/* Reception desk at entrance */}
      <group position={[0, 0, 6]}>
        <mesh position={[0, 0.4, 0]}  >
          <boxGeometry args={[3.0, 0.8, 0.8]} />
          <meshStandardMaterial color='#1a0a00' roughness={0.3} />
        </mesh>
        {/* Gold accent panel */}
        <mesh position={[0, 0.4, 0.41]}>
          <boxGeometry args={[2.8, 0.15, 0.01]} />
          <meshStandardMaterial
            color='#d4af37'
            emissive='#b8941e'
            emissiveIntensity={0.4}
            roughness={0.2}
            metalness={0.9}
          />
        </mesh>
        {/* Computer monitor */}
        <mesh position={[0, 0.9, 0]}>
          <boxGeometry args={[0.4, 0.3, 0.02]} />
          <meshStandardMaterial color='#0a0a0a' roughness={0.3} />
        </mesh>
        <mesh position={[0, 0.9, 0.01]}>
          <boxGeometry args={[0.36, 0.26, 0.01]} />
          <meshStandardMaterial
            color='#1e40af'
            emissive='#1e3a8a'
            emissiveIntensity={0.5}
            roughness={0.2}
          />
        </mesh>
      </group>

      {/* Bookshelves on back wall */}
      {[[-7, -6.85], [0, -6.85], [7, -6.85]].map(([x, z], i) => (
        <group key={`shelf${i}`} position={[x, 0, z]}>
          <mesh position={[0, 0.9, 0]}  >
            <boxGeometry args={[2.0, 1.8, 0.3]} />
            <meshStandardMaterial color='#1a0a00' roughness={0.5} />
          </mesh>
          {/* Shelves */}
          {[0.6, 1.2, 1.6].map((y, j) => (
            <mesh key={j} position={[0, y, 0]}>
              <boxGeometry args={[1.95, 0.03, 0.28]} />
              <meshStandardMaterial color='#2a1a00' roughness={0.4} />
            </mesh>
          ))}
          {/* Books */}
          {[...Array(8)].map((_, j) => {
            const shelfY = [0.65, 1.25, 1.65][Math.floor(j / 3)];
            const offsetX = (j % 3 - 1) * 0.5;
            return (
              <mesh
                key={`book${j}`}
                position={[offsetX, shelfY, 0.05]}
                rotation={[0, Math.random() * 0.2 - 0.1, 0]}
              >
                <boxGeometry args={[0.15, 0.2, 0.04]} />
                <meshStandardMaterial
                  color={['#3b82f6', '#10b981', '#f59e0b', '#ec4899'][j % 4]}
                  roughness={0.8}
                />
              </mesh>
            );
          })}
        </group>
      ))}

      {/* Lounge area with sofas */}
      <group position={[-7, 0, -2]}>
        {/* Main sofa */}
        <mesh position={[0, 0.35, 0]}  >
          <boxGeometry args={[2.0, 0.5, 0.8]} />
          <meshStandardMaterial color='#374151' roughness={0.8} />
        </mesh>
        <mesh position={[0, 0.5, -0.35]}>
          <boxGeometry args={[2.0, 0.6, 0.1]} />
          <meshStandardMaterial color='#374151' roughness={0.8} />
        </mesh>
        {/* Armrests */}
        {[-1, 1].map((x, i) => (
          <mesh key={i} position={[x, 0.5, 0]}>
            <boxGeometry args={[0.1, 0.6, 0.8]} />
            <meshStandardMaterial color='#374151' roughness={0.8} />
          </mesh>
        ))}
        {/* Coffee table */}
        <mesh position={[0, 0.2, 0.9]} >
          <cylinderGeometry args={[0.4, 0.4, 0.4, 16]} />
          <meshStandardMaterial color='#1a1a2e' roughness={0.2} metalness={0.1} />
        </mesh>
      </group>

      {/* Wall art / paintings */}
      {[[4, -6.9], [-4, -6.9]].map(([x, z], i) => (
        <group key={`art${i}`} position={[x, 1.5, z]}>
          <mesh>
            <boxGeometry args={[0.8, 1.0, 0.02]} />
            <meshStandardMaterial color='#0a0a1a' roughness={0.5} />
          </mesh>
          <mesh position={[0, 0, 0.01]}>
            <boxGeometry args={[0.7, 0.9, 0.01]} />
            <meshStandardMaterial
              color={i === 0 ? '#d4af37' : '#3b82f6'}
              emissive={i === 0 ? '#b8941e' : '#1e40af'}
              emissiveIntensity={0.2}
              roughness={0.6}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
});

// ─── Jukebox machine ──────────────────────────────────────────────────────────
function Jukebox({ isPlaying }: { isPlaying: boolean }) {
  const glowRef = useRef<THREE.Mesh>(null!);
  const noteRef1 = useRef<THREE.Mesh>(null!);
  const noteRef2 = useRef<THREE.Mesh>(null!);

  useFrame((state) => {
    if (glowRef.current) {
      const t = state.clock.elapsedTime;
      (glowRef.current.material as THREE.MeshLambertMaterial).emissiveIntensity =
        isPlaying ? 0.5 + Math.sin(t * 4) * 0.3 : 0.1;
    }
    if (noteRef1.current && noteRef2.current) {
      const t = state.clock.elapsedTime;
      if (isPlaying) {
        noteRef1.current.position.y = 1.5 + Math.sin(t * 3) * 0.2;
        noteRef1.current.position.x = 0.2 + Math.sin(t * 2) * 0.15;
        noteRef1.current.visible = true;
        noteRef2.current.position.y = 1.4 + Math.sin(t * 3.5 + 1) * 0.2;
        noteRef2.current.position.x = -0.1 + Math.sin(t * 2.5 + 0.5) * 0.15;
        noteRef2.current.visible = true;
      } else {
        noteRef1.current.visible = false;
        noteRef2.current.visible = false;
      }
    }
  });

  return (
    <group position={[-4.8, 0, -2.0]}>
      {/* Body — premium black */}
      <mesh position={[0, 0.55, 0]} >
        <boxGeometry args={[0.45, 1.1, 0.3]} />
        <meshLambertMaterial color='#0a0a1a' />
      </mesh>
      {/* Gold trim */}
      <mesh position={[0, 0, 0]}>
        <boxGeometry args={[0.46, 0.03, 0.31]} />
        <meshLambertMaterial color='#d4af37' emissive='#b8941e' emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0, 1.1, 0]}>
        <boxGeometry args={[0.46, 0.03, 0.31]} />
        <meshLambertMaterial color='#d4af37' emissive='#b8941e' emissiveIntensity={0.4} />
      </mesh>
      {/* Screen */}
      <mesh ref={glowRef} position={[0, 0.7, 0.16]}>
        <boxGeometry args={[0.3, 0.35, 0.01]} />
        <meshLambertMaterial color='#ec4899' emissive='#be185d' emissiveIntensity={isPlaying ? 0.6 : 0.1} />
      </mesh>
      {/* Speaker grille */}
      {[[-0.08, 0.35], [0, 0.35], [0.08, 0.35]].map(([dx, dy], i) => (
        <mesh key={i} position={[dx as number, dy as number, 0.155]}>
          <sphereGeometry args={[0.025, 6, 6]} />
          <meshLambertMaterial color='#d4af37' />
        </mesh>
      ))}
      {/* Dome top */}
      <mesh position={[0, 1.14, 0]} >
        <sphereGeometry args={[0.18, 8, 8, 0, Math.PI * 2, 0, Math.PI / 2]} />
        <meshLambertMaterial color='#d4af37' emissive='#b8941e' emissiveIntensity={0.3} />
      </mesh>
      {/* Music notes */}
      <mesh ref={noteRef1} position={[0.1, 1.5, 0]} visible={false}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshLambertMaterial color='#fbbf24' emissive='#d97706' emissiveIntensity={0.8} />
      </mesh>
      <mesh ref={noteRef2} position={[-0.1, 1.4, 0]} visible={false}>
        <boxGeometry args={[0.06, 0.06, 0.02]} />
        <meshLambertMaterial color='#a78bfa' emissive='#7c3aed' emissiveIntensity={0.8} />
      </mesh>
      {/* Label */}
      <Html position={[0, -0.08, 0.16]} center distanceFactor={6} zIndexRange={[5,0]}>
        <div style={{ color:'#d4af37', fontSize:9, fontWeight:700, fontFamily:'Inter,sans-serif',
          letterSpacing:'0.1em', pointerEvents:'none', textShadow:'0 1px 3px rgba(0,0,0,0.8)' }}>
          JUKEBOX
        </div>
      </Html>
    </group>
  );
}

// ─── Voxel Agent Character ─────────────────────────────────────────────────────
interface AgentCharacterProps {
  name: string;
  color: string;
  skinColor: string;
  status: string;
  role: string;
  deskPos: [number, number, number];
  isPlaying: boolean;
  agentId: number;
  isBoss: boolean;
}

// Activity locations agents can visit
const ACTIVITY_SPOTS: { pos: [number,number,number]; type: string }[] = [
  // Gym activities
  { pos: [-22, 0, -5], type: 'treadmill' },
  { pos: [-19, 0, -5], type: 'treadmill' },
  { pos: [-16, 0, -5], type: 'treadmill' },
  { pos: [-19, 0, 0], type: 'benchpress' },
  { pos: [-19, 0, 3], type: 'yoga' },
  // Break room activities
  { pos: [17, 0, -6], type: 'coffee' },
  { pos: [19, 0, 1], type: 'dining' },
  { pos: [17, 0, 5], type: 'lounge' },
  // Boardroom
  { pos: [7, 0, -11], type: 'meeting' },
  // Server room
  { pos: [-4, 0, -11], type: 'sitting' },
  // Rooftop
  { pos: [2, 2.2, 11], type: 'lounge' },
  { pos: [21, 0, 5], type: 'lounge' },
];

type AgentState = 'sitting' | 'walking' | 'dancing' | 'typing' | 'treadmill' | 'benchpress' | 'yoga' | 'coffee' | 'dining' | 'lounge' | 'phone' | 'meeting';

function AgentCharacter({ name, color, skinColor, status, role, deskPos, isPlaying, agentId, isBoss }: AgentCharacterProps) {
  const groupRef = useRef<THREE.Group>(null!);
  const leftArmRef = useRef<THREE.Group>(null!);
  const rightArmRef = useRef<THREE.Group>(null!);
  const leftLegRef = useRef<THREE.Group>(null!);
  const rightLegRef = useRef<THREE.Group>(null!);
  const bodyRef = useRef<THREE.Group>(null!);

  const stateRef = useRef<AgentState>('sitting');
  const targetRef = useRef<[number, number, number]>(deskPos);
  const timerRef = useRef(Math.random() * 5 + agentId * 1.2);
  const activityRef = useRef<string>('');

  const scale = isBoss ? 1.15 : 1.0;
  // Seated Y offset: legs bend, body lowers to chair height
  const SEAT_Y = -0.28;
  const BOUNDS = { minX: -25.0, maxX: 25.0, minZ: -14.0, maxZ: 13.0 };

  // Pick a random activity (gym, break room, or walk)
  const pickActivity = () => {
    const roll = Math.random();
    if (roll < 0.3) {
      // Go to a random activity spot
      const spot = ACTIVITY_SPOTS[Math.floor(Math.random() * ACTIVITY_SPOTS.length)];
      targetRef.current = spot.pos;
      activityRef.current = spot.type;
    } else if (roll < 0.6) {
      // Walk to random waypoint
      const wp = WAYPOINTS[Math.floor(Math.random() * WAYPOINTS.length)];
      targetRef.current = wp;
      activityRef.current = '';
    } else {
      // Go back to desk
      targetRef.current = deskPos;
      activityRef.current = 'desk';
    }
    stateRef.current = 'walking';
    timerRef.current = 12 + Math.random() * 10;
  };

  useFrame((state) => {
    if (!groupRef.current) return;
    const t = state.clock.elapsedTime;
    const delta = 0.016;

    if (isPlaying) {
      stateRef.current = 'dancing';
    } else {
      timerRef.current -= delta;

      // Transition from idle states when timer runs out
      const idleStates: AgentState[] = ['sitting', 'typing', 'treadmill', 'benchpress', 'yoga', 'coffee', 'dining', 'lounge', 'phone'];
      if (idleStates.includes(stateRef.current) && timerRef.current <= 0) {
        pickActivity();
      }

      if (stateRef.current === 'walking') {
        const cur = groupRef.current.position;
        const [tx, , tz] = targetRef.current;
        const dx = tx - cur.x;
        const dz = tz - cur.z;
        const dist = Math.sqrt(dx * dx + dz * dz);

        // Reset Y to standing when walking
        cur.y += (0 - cur.y) * 0.15;

        if (dist < 0.15) {
          // Arrived — pick state based on activity
          const act = activityRef.current;
          if (act === 'desk') {
            stateRef.current = Math.random() < 0.5 ? 'typing' : (Math.random() < 0.5 ? 'phone' : 'sitting');
          } else if (act === 'treadmill') stateRef.current = 'treadmill';
          else if (act === 'benchpress') stateRef.current = 'benchpress';
          else if (act === 'yoga') stateRef.current = 'yoga';
          else if (act === 'coffee') stateRef.current = 'coffee';
          else if (act === 'dining') stateRef.current = 'dining';
          else if (act === 'lounge') stateRef.current = 'lounge';
          else if (act === 'meeting') stateRef.current = 'meeting';
          else stateRef.current = 'sitting';
          timerRef.current = 8 + Math.random() * 15;
        } else {
          const speed = isBoss ? 0.8 : 1.2;
          cur.x = Math.max(BOUNDS.minX, Math.min(BOUNDS.maxX, cur.x + (dx / dist) * speed * delta));
          cur.z = Math.max(BOUNDS.minZ, Math.min(BOUNDS.maxZ, cur.z + (dz / dist) * speed * delta));
          groupRef.current.rotation.y = Math.atan2(dx, dz);
        }
      }

      // When at desk, drift toward desk position
      if (stateRef.current === 'sitting' || stateRef.current === 'typing' || stateRef.current === 'phone') {
        const cur = groupRef.current.position;
        cur.x += (deskPos[0] - cur.x) * 0.08;
        cur.z += ((deskPos[2] + 0.35) - cur.z) * 0.08; // sit in chair, slightly behind desk
        cur.y += (SEAT_Y - cur.y) * 0.1; // lower to seated position
        // Face the desk
        groupRef.current.rotation.y += (Math.PI - groupRef.current.rotation.y) * 0.1;
      }
    }

    // ── Animations per state ──
    if (stateRef.current === 'dancing') {
      groupRef.current.position.y = Math.sin(t * 8) * 0.06;
      if (bodyRef.current) bodyRef.current.rotation.y = Math.sin(t * 6) * 0.4;
      if (leftArmRef.current) leftArmRef.current.rotation.x = Math.sin(t * 8 + 0.5) * 1.2;
      if (rightArmRef.current) rightArmRef.current.rotation.x = Math.sin(t * 8 - 0.5) * -1.2;
      if (leftLegRef.current) leftLegRef.current.rotation.x = Math.sin(t * 8) * 0.6;
      if (rightLegRef.current) rightLegRef.current.rotation.x = Math.sin(t * 8 + Math.PI) * 0.6;
    } else if (stateRef.current === 'walking') {
      if (leftArmRef.current) leftArmRef.current.rotation.x = Math.sin(t * 6) * 0.5;
      if (rightArmRef.current) rightArmRef.current.rotation.x = Math.sin(t * 6 + Math.PI) * 0.5;
      if (leftLegRef.current) leftLegRef.current.rotation.x = Math.sin(t * 6 + Math.PI) * 0.5;
      if (rightLegRef.current) rightLegRef.current.rotation.x = Math.sin(t * 6) * 0.5;
      if (bodyRef.current) bodyRef.current.rotation.y = 0;
      groupRef.current.position.y = Math.abs(Math.sin(t * 6)) * 0.02;
    } else if (stateRef.current === 'sitting' || stateRef.current === 'dining' || stateRef.current === 'lounge' || stateRef.current === 'meeting') {
      // Seated: legs bent forward at 90°, arms resting
      if (leftLegRef.current) leftLegRef.current.rotation.x = -Math.PI / 2;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -Math.PI / 2;
      if (leftArmRef.current) leftArmRef.current.rotation.x = -0.3 + Math.sin(t * 2 + agentId) * 0.05;
      if (rightArmRef.current) rightArmRef.current.rotation.x = -0.3 + Math.sin(t * 2 + agentId + 1) * 0.05;
      if (bodyRef.current) bodyRef.current.rotation.y = 0;
    } else if (stateRef.current === 'typing') {
      // Seated + typing: rapid arm movement
      if (leftLegRef.current) leftLegRef.current.rotation.x = -Math.PI / 2;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -Math.PI / 2;
      if (leftArmRef.current) leftArmRef.current.rotation.x = -0.8 + Math.sin(t * 12 + agentId) * 0.1;
      if (rightArmRef.current) rightArmRef.current.rotation.x = -0.8 + Math.sin(t * 12 + agentId + 2) * 0.1;
      if (bodyRef.current) bodyRef.current.rotation.y = 0;
    } else if (stateRef.current === 'phone') {
      // Seated, one arm up to ear holding phone
      if (leftLegRef.current) leftLegRef.current.rotation.x = -Math.PI / 2;
      if (rightLegRef.current) rightLegRef.current.rotation.x = -Math.PI / 2;
      if (leftArmRef.current) leftArmRef.current.rotation.x = -0.3;
      if (rightArmRef.current) rightArmRef.current.rotation.x = -2.5 + Math.sin(t * 1.5) * 0.05; // arm up to ear
      if (bodyRef.current) bodyRef.current.rotation.y = Math.sin(t * 0.8) * 0.15; // slight sway while talking
    } else if (stateRef.current === 'treadmill') {
      // Running on treadmill: fast leg/arm cycle, stationary position
      groupRef.current.position.y = Math.abs(Math.sin(t * 10)) * 0.03;
      if (leftArmRef.current) leftArmRef.current.rotation.x = Math.sin(t * 10) * 0.7;
      if (rightArmRef.current) rightArmRef.current.rotation.x = Math.sin(t * 10 + Math.PI) * 0.7;
      if (leftLegRef.current) leftLegRef.current.rotation.x = Math.sin(t * 10 + Math.PI) * 0.8;
      if (rightLegRef.current) rightLegRef.current.rotation.x = Math.sin(t * 10) * 0.8;
      if (bodyRef.current) bodyRef.current.rotation.y = 0;
    } else if (stateRef.current === 'benchpress') {
      // Lying down pushing arms up
      groupRef.current.position.y = -0.4; // lying height
      if (bodyRef.current) bodyRef.current.rotation.x = -Math.PI / 2; // lying back
      if (leftArmRef.current) leftArmRef.current.rotation.x = Math.sin(t * 3) * 0.8 - 1.5;
      if (rightArmRef.current) rightArmRef.current.rotation.x = Math.sin(t * 3) * 0.8 - 1.5;
      if (leftLegRef.current) leftLegRef.current.rotation.x = 0;
      if (rightLegRef.current) rightLegRef.current.rotation.x = 0;
    } else if (stateRef.current === 'yoga') {
      // Slow stretching
      groupRef.current.position.y = 0;
      if (leftArmRef.current) leftArmRef.current.rotation.x = Math.sin(t * 1.5) * 1.5;
      if (rightArmRef.current) rightArmRef.current.rotation.x = Math.sin(t * 1.5 + Math.PI) * 1.5;
      if (leftLegRef.current) leftLegRef.current.rotation.x = Math.sin(t * 1) * 0.3;
      if (rightLegRef.current) rightLegRef.current.rotation.x = Math.sin(t * 1 + Math.PI) * 0.3;
      if (bodyRef.current) { bodyRef.current.rotation.y = Math.sin(t * 0.8) * 0.2; bodyRef.current.rotation.x = 0; }
    } else if (stateRef.current === 'coffee') {
      // Standing, one arm raised holding cup
      groupRef.current.position.y = 0;
      if (leftArmRef.current) leftArmRef.current.rotation.x = -0.3;
      if (rightArmRef.current) rightArmRef.current.rotation.x = -1.8 + Math.sin(t * 2) * 0.15; // sipping
      if (leftLegRef.current) leftLegRef.current.rotation.x = 0;
      if (rightLegRef.current) rightLegRef.current.rotation.x = 0;
      if (bodyRef.current) bodyRef.current.rotation.y = 0;
    } else {
      // Default idle
      groupRef.current.position.y = 0;
      if (bodyRef.current) bodyRef.current.rotation.y = 0;
      if (leftArmRef.current) leftArmRef.current.rotation.x = -0.6 + Math.sin(t * 4 + agentId) * 0.15;
      if (rightArmRef.current) rightArmRef.current.rotation.x = -0.6 + Math.sin(t * 4 + agentId + 1) * 0.15;
      if (leftLegRef.current) leftLegRef.current.rotation.x = 0;
      if (rightLegRef.current) rightLegRef.current.rotation.x = 0;
    }

    // Reset body rotation for non-benchpress states
    if (stateRef.current !== 'benchpress' && bodyRef.current) {
      bodyRef.current.rotation.x += (0 - bodyRef.current.rotation.x) * 0.1;
    }
  });

  const statusColor = status === 'active' ? '#22c55e' : status === 'busy' ? '#f59e0b' : '#6b7280';
  // Casual: jeans for most, boss gets dark chinos
  const pantsColor = isBoss ? '#1a1a2e' : '#2a3a5f';
  const shoeColor = isBoss ? '#1a0a00' : '#4a4a5a';
  const [clicked, setClicked] = useState(false);

  // Speech bubble messages per state
  const SPEECH: Record<string, string[]> = {
    typing: ['Updating deal pipeline...', 'Sending follow-up email...', 'Processing application...', 'Running credit analysis...', 'Closing deal #42...'],
    phone: ['On call with borrower...', 'Discussing loan terms...', 'Scheduling site visit...', 'Negotiating rates...'],
    sitting: ['Reviewing documents...', 'Checking dashboard...', 'Analyzing market data...'],
    treadmill: ['Getting those steps in!', 'Cardio session 💪', 'Morning run...'],
    benchpress: ['Chest day! 💪', 'Pushing iron...', 'One more rep...'],
    yoga: ['Finding inner peace...', 'Stretching it out...', 'Namaste 🧘'],
    coffee: ['Need this caffeine...', 'Coffee break ☕', 'Refueling...'],
    dining: ['Lunch break 🍽️', 'Team lunch...', 'Quick bite...'],
    lounge: ['Taking a breather...', 'Quick break...', 'Recharging...'],
    meeting: ['In a board meeting...', 'Presenting Q4 results...', 'Strategy session...'],
    walking: ['Heading out...', 'On the move...', 'Walking over...'],
    dancing: ['Party time! 🎉', 'Let\'s go! 🔥', 'Vibes! 💃'],
  };
  const speechMsg = useMemo(() => {
    const msgs = SPEECH[stateRef.current] || ['Working...'];
    return msgs[agentId % msgs.length];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  // Unique accessories per agent
  const ACCESSORIES: Record<string, { type: string }> = {
    'Kingpin': { type: 'sunglasses' },
    'Zurie': { type: 'headset' },
    'JARVIS': { type: 'visor' },
    'Scout': { type: 'cap' },
    'Closer': { type: 'bowtie' },
  };
  const accessory = ACCESSORIES[name];

  return (
    <group ref={groupRef} position={[deskPos[0], 0, deskPos[2]]} scale={[scale, scale, scale]} onClick={(e) => { e.stopPropagation(); setClicked(!clicked); }}>
      <group ref={bodyRef}>
        {/* ── ACCESSORIES ── */}
        {accessory?.type === 'sunglasses' && (
          <group position={[0, 1.11, 0.15]}>
            <mesh><boxGeometry args={[0.16, 0.04, 0.01]} /><meshStandardMaterial color="#0a0a0a" metalness={0.8} roughness={0.1} /></mesh>
            <mesh position={[-0.055, 0, 0.005]}><boxGeometry args={[0.05, 0.035, 0.01]} /><meshStandardMaterial color="#1a1a2e" metalness={0.9} roughness={0.05} /></mesh>
            <mesh position={[0.055, 0, 0.005]}><boxGeometry args={[0.05, 0.035, 0.01]} /><meshStandardMaterial color="#1a1a2e" metalness={0.9} roughness={0.05} /></mesh>
          </group>
        )}
        {accessory?.type === 'headset' && (
          <group position={[0, 1.18, 0]}>
            <mesh rotation={[0, 0, Math.PI / 2]}><torusGeometry args={[0.13, 0.01, 8, 16, Math.PI]} /><meshStandardMaterial color="#374151" metalness={0.5} roughness={0.3} /></mesh>
            <mesh position={[-0.13, -0.06, 0.05]}><sphereGeometry args={[0.025, 8, 8]} /><meshStandardMaterial color="#374151" metalness={0.5} /></mesh>
            <mesh position={[-0.1, -0.1, 0.1]}><cylinderGeometry args={[0.005, 0.005, 0.08, 6]} /><meshStandardMaterial color="#374151" /></mesh>
            <mesh position={[-0.1, -0.14, 0.12]}><sphereGeometry args={[0.015, 6, 6]} /><meshStandardMaterial color="#1a1a2e" /></mesh>
          </group>
        )}
        {accessory?.type === 'visor' && (
          <mesh position={[0, 1.12, 0.14]}>
            <boxGeometry args={[0.18, 0.03, 0.01]} />
            <meshStandardMaterial color="#3b82f6" emissive="#1e40af" emissiveIntensity={0.8} transparent opacity={0.6} />
          </mesh>
        )}
        {accessory?.type === 'cap' && (
          <group position={[0, 1.22, 0]}>
            <mesh><sphereGeometry args={[0.15, 12, 12, 0, Math.PI * 2, 0, Math.PI / 2]} /><meshStandardMaterial color="#ef4444" roughness={0.8} /></mesh>
            <mesh position={[0, -0.02, 0.12]}><boxGeometry args={[0.18, 0.02, 0.08]} /><meshStandardMaterial color="#ef4444" roughness={0.8} /></mesh>
          </group>
        )}
        {accessory?.type === 'bowtie' && (
          <group position={[0, 0.95, 0.15]}>
            <mesh position={[-0.025, 0, 0]} rotation={[0, 0, 0.3]}><boxGeometry args={[0.04, 0.025, 0.01]} /><meshStandardMaterial color="#ec4899" roughness={0.5} /></mesh>
            <mesh position={[0.025, 0, 0]} rotation={[0, 0, -0.3]}><boxGeometry args={[0.04, 0.025, 0.01]} /><meshStandardMaterial color="#ec4899" roughness={0.5} /></mesh>
            <mesh><sphereGeometry args={[0.008, 6, 6]} /><meshStandardMaterial color="#ec4899" /></mesh>
          </group>
        )}

        {/* HEAD — slightly egg-shaped, warm tones, matte finish */}
        <mesh position={[0, 1.1, 0]} scale={[1, 1.08, 1]}>
          <sphereGeometry args={[0.15, 20, 20]} />
          <meshLambertMaterial color={skinColor} />
        </mesh>

        {/* EYES — white spheres sitting on head surface, big and expressive */}
        {/* Left eye */}
        <mesh position={[-0.055, 1.09, 0.125]}>
          <sphereGeometry args={[0.027, 14, 14]} />
          <meshLambertMaterial color='#ffffff' />
        </mesh>
        {/* Left pupil — large, dark, gives life */}
        <mesh position={[-0.055, 1.09, 0.145]}>
          <sphereGeometry args={[0.017, 10, 10]} />
          <meshLambertMaterial color='#1a1a2e' />
        </mesh>
        {/* Left eye sparkle */}
        <mesh position={[-0.047, 1.097, 0.148]}>
          <sphereGeometry args={[0.005, 6, 6]} />
          <meshLambertMaterial color='#ffffff' emissive='#ffffff' emissiveIntensity={0.6} />
        </mesh>

        {/* Right eye */}
        <mesh position={[0.055, 1.09, 0.125]}>
          <sphereGeometry args={[0.027, 14, 14]} />
          <meshLambertMaterial color='#ffffff' />
        </mesh>
        {/* Right pupil */}
        <mesh position={[0.055, 1.09, 0.145]}>
          <sphereGeometry args={[0.017, 10, 10]} />
          <meshLambertMaterial color='#1a1a2e' />
        </mesh>
        {/* Right eye sparkle */}
        <mesh position={[0.063, 1.097, 0.148]}>
          <sphereGeometry args={[0.005, 6, 6]} />
          <meshLambertMaterial color='#ffffff' emissive='#ffffff' emissiveIntensity={0.6} />
        </mesh>

        {/* MOUTH — warm smile, simple arc */}
        <mesh position={[0, 1.04, 0.135]} rotation={[0.2, 0, 0]}>
          <torusGeometry args={[0.032, 0.005, 6, 14, Math.PI]} />
          <meshLambertMaterial color='#c45c50' />
        </mesh>

        {/* HAIR — rounded cap, sits on top half of head */}
        <mesh position={[0, 1.17, -0.01]}>
          <sphereGeometry args={[0.158, 16, 16, 0, Math.PI * 2, 0, Math.PI * 0.52]} />
          <meshLambertMaterial color={isBoss ? '#1a0a00' : color} />
        </mesh>
        {/* Hair fringe/bangs — small box across forehead */}
        <mesh position={[0, 1.17, 0.1]}>
          <boxGeometry args={[0.22, 0.035, 0.06]} />
          <meshLambertMaterial color={isBoss ? '#1a0a00' : color} />
        </mesh>
        {isBoss && (
          <>
            {/* Gold crown for boss */}
            <mesh position={[-0.08, 1.26, 0]}>
              <boxGeometry args={[0.04, 0.05, 0.04]} />
              <meshStandardMaterial
                color='#d4af37'
                emissive='#b8941e'
                emissiveIntensity={0.6}
                roughness={0.15}
                metalness={0.95}
              />
            </mesh>
            <mesh position={[0, 1.28, 0]}>
              <boxGeometry args={[0.04, 0.07, 0.04]} />
              <meshStandardMaterial
                color='#d4af37'
                emissive='#b8941e'
                emissiveIntensity={0.6}
                roughness={0.15}
                metalness={0.95}
              />
            </mesh>
            <mesh position={[0.08, 1.26, 0]}>
              <boxGeometry args={[0.04, 0.05, 0.04]} />
              <meshStandardMaterial
                color='#d4af37'
                emissive='#b8941e'
                emissiveIntensity={0.6}
                roughness={0.15}
                metalness={0.95}
              />
            </mesh>
          </>
        )}

        {/* Neck */}
        <mesh position={[0, 0.98, 0]} >
          <cylinderGeometry args={[0.04, 0.05, 0.08, 16]} />
          <meshStandardMaterial color={skinColor} roughness={0.9} />
        </mesh>

        {/* TORSO — casual t-shirt / polo */}
        <mesh position={[0, 0.82, 0]}>
          <capsuleGeometry args={[0.14, 0.22, 12, 24]} />
          <meshStandardMaterial color={color} roughness={0.8} metalness={0.0} />
        </mesh>

        {/* T-shirt neckline (round collar) */}
        <mesh position={[0, 0.94, 0.08]} rotation={[0.3, 0, 0]}>
          <torusGeometry args={[0.06, 0.008, 8, 16, Math.PI]} />
          <meshStandardMaterial color={color} roughness={0.8} />
        </mesh>

        {/* Boss gets a small gold chain */}
        {isBoss && (
          <mesh position={[0, 0.9, 0.14]} rotation={[0.15, 0, 0]}>
            <torusGeometry args={[0.04, 0.003, 6, 16, Math.PI]} />
            <meshStandardMaterial color='#d4af37' metalness={0.9} roughness={0.1} />
          </mesh>
        )}

        {/* LEFT ARM - Realistic cylinders */}
        <group ref={leftArmRef} position={[-0.18, 0.88, 0]}>
          {/* Upper arm - suit sleeve */}
          <mesh position={[0, -0.1, 0]}  >
            <cylinderGeometry args={[0.035, 0.04, 0.22, 16]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
          {/* Elbow joint */}
          <mesh position={[0, -0.21, 0]}>
            <sphereGeometry args={[0.04, 12, 12]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
          {/* Forearm - exposed skin */}
          <mesh position={[0, -0.32, 0]}  >
            <cylinderGeometry args={[0.03, 0.035, 0.20, 16]} />
            <meshStandardMaterial color={skinColor} roughness={0.9} />
          </mesh>
          {/* Hand */}
          <mesh position={[0, -0.43, 0]} >
            <sphereGeometry args={[0.035, 12, 12]} />
            <meshStandardMaterial color={skinColor} roughness={0.9} />
          </mesh>
        </group>

        {/* RIGHT ARM - Realistic cylinders */}
        <group ref={rightArmRef} position={[0.18, 0.88, 0]}>
          {/* Upper arm - suit sleeve */}
          <mesh position={[0, -0.1, 0]}  >
            <cylinderGeometry args={[0.035, 0.04, 0.22, 16]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
          {/* Elbow joint */}
          <mesh position={[0, -0.21, 0]}>
            <sphereGeometry args={[0.04, 12, 12]} />
            <meshStandardMaterial color={color} roughness={0.7} />
          </mesh>
          {/* Forearm - exposed skin */}
          <mesh position={[0, -0.32, 0]}  >
            <cylinderGeometry args={[0.03, 0.035, 0.20, 16]} />
            <meshStandardMaterial color={skinColor} roughness={0.9} />
          </mesh>
          {/* Hand */}
          <mesh position={[0, -0.43, 0]} >
            <sphereGeometry args={[0.035, 12, 12]} />
            <meshStandardMaterial color={skinColor} roughness={0.9} />
          </mesh>
        </group>

        {/* LEFT LEG - Realistic cylinders */}
        <group ref={leftLegRef} position={[-0.062, 0.68, 0]}>
          {/* Thigh */}
          <mesh position={[0, -0.12, 0]}  >
            <cylinderGeometry args={[0.045, 0.05, 0.26, 16]} />
            <meshStandardMaterial color={pantsColor} roughness={0.7} />
          </mesh>
          {/* Knee */}
          <mesh position={[0, -0.25, 0]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshStandardMaterial color={pantsColor} roughness={0.7} />
          </mesh>
          {/* Shin */}
          <mesh position={[0, -0.36, 0]}  >
            <cylinderGeometry args={[0.04, 0.045, 0.20, 16]} />
            <meshStandardMaterial color={pantsColor} roughness={0.7} />
          </mesh>
          {/* Shoe - realistic rounded */}
          <mesh position={[0, -0.48, 0.03]}  >
            <boxGeometry args={[0.09, 0.06, 0.15]} />
            <meshStandardMaterial
              color={shoeColor}
              roughness={0.4}
              metalness={isBoss ? 0.6 : 0.1}
            />
          </mesh>
        </group>

        {/* RIGHT LEG - Realistic cylinders */}
        <group ref={rightLegRef} position={[0.062, 0.68, 0]}>
          {/* Thigh */}
          <mesh position={[0, -0.12, 0]}  >
            <cylinderGeometry args={[0.045, 0.05, 0.26, 16]} />
            <meshStandardMaterial color={pantsColor} roughness={0.7} />
          </mesh>
          {/* Knee */}
          <mesh position={[0, -0.25, 0]}>
            <sphereGeometry args={[0.05, 12, 12]} />
            <meshStandardMaterial color={pantsColor} roughness={0.7} />
          </mesh>
          {/* Shin */}
          <mesh position={[0, -0.36, 0]}  >
            <cylinderGeometry args={[0.04, 0.045, 0.20, 16]} />
            <meshStandardMaterial color={pantsColor} roughness={0.7} />
          </mesh>
          {/* Shoe - realistic rounded */}
          <mesh position={[0, -0.48, 0.03]}  >
            <boxGeometry args={[0.09, 0.06, 0.15]} />
            <meshStandardMaterial
              color={shoeColor}
              roughness={0.4}
              metalness={isBoss ? 0.6 : 0.1}
            />
          </mesh>
        </group>
      </group>

      {/* Name tag + Speech bubble */}
      <Html position={[0, 1.55, 0]} center distanceFactor={4} zIndexRange={[10, 0]}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, pointerEvents: 'none', whiteSpace: 'nowrap' }}>
          {/* Speech bubble */}
          <div style={{
            background: 'rgba(0,0,0,0.85)', borderRadius: 8, padding: '3px 10px',
            border: `1px solid ${color}33`, maxWidth: 160,
            boxShadow: `0 0 8px ${color}22`,
          }}>
            <span style={{ color: '#94a3b8', fontSize: 8, fontFamily: 'Inter, sans-serif', whiteSpace: 'normal', lineHeight: 1.3 }}>
              {speechMsg}
            </span>
          </div>
          {/* Name */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: isBoss ? 'rgba(212,175,55,0.18)' : 'rgba(0,0,0,0.72)',
            borderRadius: 6, padding: '2px 8px',
            backdropFilter: 'blur(4px)',
            border: isBoss ? '1px solid rgba(212,175,55,0.4)' : '1px solid rgba(255,255,255,0.12)',
          }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: isBoss ? '#d4af37' : statusColor, display: 'inline-block' }} />
            <span style={{ color: isBoss ? '#d4af37' : '#fff', fontSize: isBoss ? 12 : 11, fontWeight: isBoss ? 800 : 600, fontFamily: 'Inter, sans-serif' }}>
              {isBoss ? '👑 ' : ''}{name}
            </span>
          </div>
          <span style={{ color: '#64748b', fontSize: 8, fontWeight: 500, fontFamily: 'Inter, sans-serif' }}>{role}</span>
        </div>
      </Html>

      {/* Click-to-interact stats panel */}
      {clicked && (
        <Html position={[0.8, 1.2, 0]} distanceFactor={3} zIndexRange={[20, 0]}>
          <div onClick={(e) => e.stopPropagation()} style={{
            background: 'rgba(10,10,26,0.95)', borderRadius: 12, padding: 14, width: 180,
            border: `1px solid ${color}44`, boxShadow: `0 4px 20px rgba(0,0,0,0.6), 0 0 15px ${color}22`,
            fontFamily: 'Inter, sans-serif', cursor: 'default',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: '#fff', fontSize: 13, fontWeight: 800 }}>{name}</span>
              <span onClick={() => setClicked(false)} style={{ color: '#64748b', fontSize: 14, cursor: 'pointer', pointerEvents: 'auto' }}>✕</span>
            </div>
            <div style={{ color: '#64748b', fontSize: 9, marginBottom: 8, borderBottom: '1px solid #1e293b', paddingBottom: 6 }}>{role} Agent</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8', fontSize: 9 }}>Status</span>
                <span style={{ color: statusColor, fontSize: 9, fontWeight: 700 }}>{stateRef.current}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8', fontSize: 9 }}>Deals Today</span>
                <span style={{ color: '#10b981', fontSize: 9, fontWeight: 700 }}>{3 + agentId * 2}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8', fontSize: 9 }}>Leads Processed</span>
                <span style={{ color: '#3b82f6', fontSize: 9, fontWeight: 700 }}>{12 + agentId * 5}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#94a3b8', fontSize: 9 }}>Revenue</span>
                <span style={{ color: '#d4af37', fontSize: 9, fontWeight: 700 }}>${(150 + agentId * 80).toLocaleString()}K</span>
              </div>
              <div style={{ marginTop: 4, background: '#1e293b', borderRadius: 4, height: 4 }}>
                <div style={{ background: color, borderRadius: 4, height: 4, width: `${60 + agentId * 5}%` }} />
              </div>
              <span style={{ color: '#475569', fontSize: 8, textAlign: 'center' }}>Performance: {60 + agentId * 5}%</span>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

// ─── Gym Room ────────────────────────────────────────────────────────────────
const GymRoom = memo(() => {
  const metalGrey = useMemo(() => new THREE.MeshStandardMaterial({ color: '#374151', roughness: 0.3, metalness: 0.7 }), []);
  const darkMat = useMemo(() => new THREE.MeshLambertMaterial({ color: '#2a2a2a' }), []);
  const redAccent = useMemo(() => new THREE.MeshLambertMaterial({ color: '#ef4444', emissive: '#991b1b', emissiveIntensity: 0.2 }), []);
  const mirrorMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#b0c4de', metalness: 0.9, roughness: 0.05, transparent: true, opacity: 0.7 }), []);

  return (
    <group>
      {/* Treadmills (3) */}
      {[-22, -19, -16].map((x, i) => (
        <group key={`tread${i}`} position={[x, 0, -5]}>
          <mesh position={[0, 0.08, 0]}><boxGeometry args={[0.6, 0.08, 1.4]} /><primitive object={darkMat} attach="material" /></mesh>
          <mesh position={[-0.28, 0.5, -0.5]}><cylinderGeometry args={[0.02, 0.02, 0.9, 8]} /><primitive object={metalGrey} attach="material" /></mesh>
          <mesh position={[0.28, 0.5, -0.5]}><cylinderGeometry args={[0.02, 0.02, 0.9, 8]} /><primitive object={metalGrey} attach="material" /></mesh>
          <mesh position={[0, 0.95, -0.5]}><boxGeometry args={[0.5, 0.03, 0.03]} /><primitive object={metalGrey} attach="material" /></mesh>
          <mesh position={[0, 0.85, -0.6]} rotation={[-0.3, 0, 0]}><boxGeometry args={[0.3, 0.2, 0.03]} /><primitive object={darkMat} attach="material" /></mesh>
          <mesh position={[0, 0.85, -0.58]} rotation={[-0.3, 0, 0]}><boxGeometry args={[0.25, 0.15, 0.01]} /><meshLambertMaterial color="#10b981" emissive="#047857" emissiveIntensity={0.5} /></mesh>
          <mesh position={[0, 0.13, 0]}><boxGeometry args={[0.45, 0.02, 1.2]} /><primitive object={redAccent} attach="material" /></mesh>
        </group>
      ))}
      {/* Weight Rack */}
      <group position={[-13, 0, 0]}>
        <mesh position={[-0.6, 0.7, 0]}><boxGeometry args={[0.06, 1.4, 0.06]} /><primitive object={metalGrey} attach="material" /></mesh>
        <mesh position={[0.6, 0.7, 0]}><boxGeometry args={[0.06, 1.4, 0.06]} /><primitive object={metalGrey} attach="material" /></mesh>
        {[0.3, 0.6, 0.9, 1.2].map((y, j) => (
          <group key={`wr${j}`}>
            <mesh position={[0, y, 0]}><boxGeometry args={[1.2, 0.03, 0.06]} /><primitive object={metalGrey} attach="material" /></mesh>
            <mesh position={[-0.3, y + 0.06, 0.05]}><cylinderGeometry args={[0.03, 0.03, 0.2, 8]} /><primitive object={metalGrey} attach="material" /></mesh>
            <mesh position={[0.3, y + 0.06, 0.05]}><cylinderGeometry args={[0.03, 0.03, 0.2, 8]} /><primitive object={metalGrey} attach="material" /></mesh>
          </group>
        ))}
      </group>
      {/* Bench Press */}
      <group position={[-19, 0, 0]}>
        <mesh position={[0, 0.28, 0]}><boxGeometry args={[0.3, 0.08, 1.0]} /><meshLambertMaterial color="#1a1a2e" /></mesh>
        {[[-0.12,-0.4],[0.12,-0.4],[-0.12,0.4],[0.12,0.4]].map(([x,z],i) => (
          <mesh key={i} position={[x, 0.12, z]}><boxGeometry args={[0.04, 0.24, 0.04]} /><primitive object={metalGrey} attach="material" /></mesh>
        ))}
        <mesh position={[-0.2, 0.6, -0.4]}><cylinderGeometry args={[0.02, 0.02, 0.8, 8]} /><primitive object={metalGrey} attach="material" /></mesh>
        <mesh position={[0.2, 0.6, -0.4]}><cylinderGeometry args={[0.02, 0.02, 0.8, 8]} /><primitive object={metalGrey} attach="material" /></mesh>
        <mesh position={[0, 0.95, -0.4]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.015, 0.015, 1.2, 8]} /><primitive object={metalGrey} attach="material" /></mesh>
        <mesh position={[-0.55, 0.95, -0.4]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.1, 0.1, 0.04, 12]} /><meshLambertMaterial color="#1a1a2e" /></mesh>
        <mesh position={[0.55, 0.95, -0.4]} rotation={[0, 0, Math.PI / 2]}><cylinderGeometry args={[0.1, 0.1, 0.04, 12]} /><meshLambertMaterial color="#1a1a2e" /></mesh>
      </group>
      {/* Yoga Mats */}
      {[[-22, '#7c3aed'], [-19, '#06b6d4'], [-16, '#ec4899']].map(([x, c], i) => (
        <mesh key={`mat${i}`} rotation={[-Math.PI / 2, 0, 0]} position={[x as number, 0.005, 3]}>
          <planeGeometry args={[0.7, 1.5]} /><meshStandardMaterial color={c as string} roughness={0.9} />
        </mesh>
      ))}
      {/* Mirror Wall */}
      <mesh position={[-26.96, 0.9, 0]}><boxGeometry args={[0.02, 1.8, 10]} /><primitive object={mirrorMat} attach="material" /></mesh>
      <mesh position={[-26.95, 1.8, 0]}><boxGeometry args={[0.04, 0.04, 10.1]} /><meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.2} /></mesh>
      {/* Exercise Balls */}
      <mesh position={[-23, 0.25, 1]}><sphereGeometry args={[0.25, 16, 16]} /><meshStandardMaterial color="#3b82f6" roughness={0.6} /></mesh>
      <mesh position={[-15, 0.25, 1]}><sphereGeometry args={[0.25, 16, 16]} /><meshStandardMaterial color="#10b981" roughness={0.6} /></mesh>
      {/* Gym lights */}
      {[-24, -21, -18, -15, -12].map((x, i) => (
        <mesh key={`gl${i}`} position={[x, 1.88, 0]}><boxGeometry args={[0.12, 0.03, 12]} /><meshLambertMaterial color="#ffffff" emissive="#ffffff" emissiveIntensity={0.4} /></mesh>
      ))}
      <Html position={[-19, 1.5, -6.9]} center distanceFactor={8} zIndexRange={[5,0]}>
        <div style={{ color: '#ef4444', fontSize: 22, fontWeight: 900, fontFamily: 'Inter, sans-serif', letterSpacing: '0.15em', pointerEvents: 'none', textShadow: '0 0 10px rgba(239,68,68,0.5)' }}>FITNESS CENTER</div>
      </Html>
    </group>
  );
});

// ─── Break Room ──────────────────────────────────────────────────────────────
const BreakRoom = memo(() => {
  const woodMat = useMemo(() => new THREE.MeshLambertMaterial({ color: '#2a1a00' }), []);
  const counterMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1a1a2e', roughness: 0.2, metalness: 0.3 }), []);
  const steelMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#9ca3af', roughness: 0.3, metalness: 0.6 }), []);
  const sofaMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#374151', roughness: 0.8 }), []);

  return (
    <group>
      {/* Kitchen Counter */}
      <group position={[19, 0, -6]}>
        <mesh position={[0, 0.42, 0]}><boxGeometry args={[6, 0.06, 0.8]} /><primitive object={counterMat} attach="material" /></mesh>
        <mesh position={[0, 0.18, 0]}><boxGeometry args={[6, 0.36, 0.78]} /><primitive object={woodMat} attach="material" /></mesh>
        {[-2, -1, 0, 1, 2].map((x, i) => (
          <group key={i}>
            <mesh position={[x, 0.18, 0.4]}><boxGeometry args={[0.9, 0.3, 0.01]} /><meshLambertMaterial color="#3a2a10" /></mesh>
            <mesh position={[x, 0.18, 0.42]}><boxGeometry args={[0.15, 0.02, 0.02]} /><meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.2} /></mesh>
          </group>
        ))}
      </group>
      {/* Coffee Machine */}
      <group position={[17, 0.45, -6]}>
        <mesh position={[0, 0.15, 0]}><boxGeometry args={[0.25, 0.3, 0.2]} /><meshLambertMaterial color="#0a0a0a" /></mesh>
        <mesh position={[0, 0.05, 0.1]}><boxGeometry args={[0.08, 0.02, 0.01]} /><meshLambertMaterial color="#10b981" emissive="#047857" emissiveIntensity={0.8} /></mesh>
      </group>
      {/* Sink */}
      <group position={[19, 0.45, -6]}>
        <mesh position={[0, 0, 0.05]}><boxGeometry args={[0.4, 0.08, 0.3]} /><primitive object={steelMat} attach="material" /></mesh>
        <mesh position={[0, 0.15, -0.1]}><cylinderGeometry args={[0.015, 0.015, 0.25, 8]} /><primitive object={steelMat} attach="material" /></mesh>
        <mesh position={[0, 0.25, 0]} rotation={[Math.PI / 2, 0, 0]}><cylinderGeometry args={[0.015, 0.015, 0.2, 8]} /><primitive object={steelMat} attach="material" /></mesh>
      </group>
      {/* Microwave */}
      <group position={[21, 0.45, -6]}>
        <mesh position={[0, 0.1, 0]}><boxGeometry args={[0.3, 0.2, 0.22]} /><meshLambertMaterial color="#1a1a2e" /></mesh>
        <mesh position={[0, 0.1, 0.12]}><boxGeometry args={[0.18, 0.12, 0.01]} /><meshLambertMaterial color="#0f172a" emissive="#1e40af" emissiveIntensity={0.1} /></mesh>
      </group>
      {/* Fridge */}
      <group position={[23, 0, -5.5]}>
        <mesh position={[0, 0.8, 0]}><boxGeometry args={[0.7, 1.6, 0.6]} /><primitive object={steelMat} attach="material" /></mesh>
        <mesh position={[0.3, 1.0, 0.31]}><boxGeometry args={[0.03, 0.5, 0.03]} /><meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.2} /></mesh>
        <mesh position={[0, 1.2, 0.31]}><boxGeometry args={[0.68, 0.02, 0.01]} /><meshLambertMaterial color="#6b7280" /></mesh>
      </group>
      {/* Dining Table + 6 Chairs */}
      <group position={[19, 0, 1]}>
        <mesh position={[0, 0.35, 0]}><boxGeometry args={[2.4, 0.05, 1.2]} /><primitive object={woodMat} attach="material" /></mesh>
        {[[-1,-0.5],[1,-0.5],[-1,0.5],[1,0.5]].map(([x,z],i)=>(
          <mesh key={i} position={[x,0.16,z]}><boxGeometry args={[0.04,0.33,0.04]}/><primitive object={woodMat} attach="material"/></mesh>
        ))}
        {[[-0.8,-0.9],[0,-0.9],[0.8,-0.9],[-0.8,0.9],[0,0.9],[0.8,0.9]].map(([x,z],i)=>(
          <group key={`dc${i}`} position={[x,0,z]}>
            <mesh position={[0,0.22,0]}><boxGeometry args={[0.3,0.04,0.3]}/><primitive object={woodMat} attach="material"/></mesh>
            <mesh position={[0,0.4,z>0?-0.14:0.14]}><boxGeometry args={[0.3,0.32,0.04]}/><primitive object={woodMat} attach="material"/></mesh>
          </group>
        ))}
      </group>
      {/* Vending Machine */}
      <group position={[26, 0, -2]}>
        <mesh position={[0, 0.7, 0]}><boxGeometry args={[0.6, 1.4, 0.5]} /><meshLambertMaterial color="#1a1a2e" /></mesh>
        <mesh position={[0, 0.8, 0.26]}><boxGeometry args={[0.5, 0.8, 0.01]} /><meshStandardMaterial color="#3b82f6" transparent opacity={0.4} emissive="#1e40af" emissiveIntensity={0.3} /></mesh>
        {[0.5, 0.7, 0.9, 1.1].map((y, i) => (
          <mesh key={i} position={[0, y, 0.2]}><boxGeometry args={[0.45, 0.02, 0.08]} /><primitive object={steelMat} attach="material" /></mesh>
        ))}
        <Html position={[0, 1.3, 0.27]} center distanceFactor={6} zIndexRange={[5,0]}>
          <div style={{ color: '#fbbf24', fontSize: 8, fontWeight: 900, fontFamily: 'Inter, sans-serif', letterSpacing: '0.2em', pointerEvents: 'none' }}>SNACKS</div>
        </Html>
      </group>
      {/* Lounge Sofas */}
      <group position={[17, 0, 5]}>
        <mesh position={[0,0.3,0]}><boxGeometry args={[2,0.4,0.7]}/><primitive object={sofaMat} attach="material"/></mesh>
        <mesh position={[0,0.45,-0.3]}><boxGeometry args={[2,0.5,0.08]}/><primitive object={sofaMat} attach="material"/></mesh>
        {[-1,1].map((x,i)=>(<mesh key={i} position={[x,0.45,0]}><boxGeometry args={[0.08,0.5,0.7]}/><primitive object={sofaMat} attach="material"/></mesh>))}
      </group>
      <group position={[21, 0, 5]}>
        <mesh position={[0,0.3,0]}><boxGeometry args={[2,0.4,0.7]}/><primitive object={sofaMat} attach="material"/></mesh>
        <mesh position={[0,0.45,0.3]}><boxGeometry args={[2,0.5,0.08]}/><primitive object={sofaMat} attach="material"/></mesh>
        {[-1,1].map((x,i)=>(<mesh key={i} position={[x,0.45,0]}><boxGeometry args={[0.08,0.5,0.7]}/><primitive object={sofaMat} attach="material"/></mesh>))}
      </group>
      <mesh position={[19,0.2,5]}><cylinderGeometry args={[0.4,0.4,0.4,16]}/><meshStandardMaterial color="#1a1a2e" roughness={0.2} metalness={0.1}/></mesh>
      {/* Wall TV */}
      <mesh position={[19, 1.4, 6.88]}><boxGeometry args={[2, 1.2, 0.05]} /><meshLambertMaterial color="#0a0a0a" /></mesh>
      <mesh position={[19, 1.4, 6.86]}><boxGeometry args={[1.8, 1.0, 0.01]} /><meshLambertMaterial color="#1e3a5f" emissive="#1e40af" emissiveIntensity={0.2} /></mesh>
      {/* Warm ceiling lights */}
      {[14, 17, 20, 23, 26].map((x, i) => (
        <mesh key={`bl${i}`} position={[x, 1.88, 0]}><boxGeometry args={[0.12, 0.03, 12]} /><meshLambertMaterial color="#fef3c7" emissive="#f59e0b" emissiveIntensity={0.3} /></mesh>
      ))}
      <Html position={[19, 1.5, -6.9]} center distanceFactor={8} zIndexRange={[5,0]}>
        <div style={{ color: '#f59e0b', fontSize: 22, fontWeight: 900, fontFamily: 'Inter, sans-serif', letterSpacing: '0.15em', pointerEvents: 'none', textShadow: '0 0 10px rgba(245,158,11,0.5)' }}>BREAK ROOM</div>
      </Html>
    </group>
  );
});

// ─── Boardroom ───────────────────────────────────────────────────────────────
const Boardroom = memo(() => {
  const woodMat = useMemo(() => new THREE.MeshLambertMaterial({ color: '#1a0a00' }), []);
  const glassMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#1e3a5f', transparent: true, opacity: 0.25, roughness: 0.05 }), []);
  const darkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#0f0f23', roughness: 0.7 }), []);
  const goldMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d4af37', emissive: new THREE.Color('#b8941e'), emissiveIntensity: 0.4, roughness: 0.15, metalness: 0.9 }), []);

  return (
    <group>
      {/* Floors */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[7, -0.02, -11]}>
        <planeGeometry args={[10, 8]} /><meshStandardMaterial color="#1a1a2e" roughness={0.3} metalness={0.1} />
      </mesh>
      {/* Walls */}
      <mesh position={[7, 0.9, -15]}><boxGeometry args={[10, 2, 0.08]} /><primitive object={darkMat} attach="material" /></mesh>
      <mesh position={[12, 0.9, -11]}><boxGeometry args={[0.08, 2, 8]} /><primitive object={glassMat} attach="material" /></mesh>
      <mesh position={[2, 0.9, -11]}><boxGeometry args={[0.08, 2, 8]} /><primitive object={glassMat} attach="material" /></mesh>
      {/* Gold accents */}
      <mesh position={[7, 1.85, -15]}><boxGeometry args={[10, 0.04, 0.09]} /><primitive object={goldMat} attach="material" /></mesh>
      {/* Long conference table */}
      <mesh position={[7, 0.38, -11]}><boxGeometry args={[4, 0.06, 1.2]} /><primitive object={woodMat} attach="material" /></mesh>
      <mesh position={[7, 0.18, -11]}><boxGeometry args={[0.1, 0.36, 0.1]} /><primitive object={woodMat} attach="material" /></mesh>
      {/* 10 chairs (5 per side) */}
      {[-1.6, -0.8, 0, 0.8, 1.6].map((dx, i) => (
        <group key={`bc${i}`}>
          <group position={[7 + dx, 0, -11.9]}>
            <mesh position={[0, 0.25, 0]}><boxGeometry args={[0.3, 0.04, 0.3]} /><meshLambertMaterial color="#1a1a2e" /></mesh>
            <mesh position={[0, 0.42, 0.14]}><boxGeometry args={[0.3, 0.3, 0.04]} /><meshLambertMaterial color="#1a1a2e" /></mesh>
          </group>
          <group position={[7 + dx, 0, -10.1]}>
            <mesh position={[0, 0.25, 0]}><boxGeometry args={[0.3, 0.04, 0.3]} /><meshLambertMaterial color="#1a1a2e" /></mesh>
            <mesh position={[0, 0.42, -0.14]}><boxGeometry args={[0.3, 0.3, 0.04]} /><meshLambertMaterial color="#1a1a2e" /></mesh>
          </group>
        </group>
      ))}
      {/* Whiteboard on back wall */}
      <mesh position={[7, 1.2, -14.92]}><boxGeometry args={[3, 1.4, 0.03]} /><meshStandardMaterial color="#f8fafc" roughness={0.2} /></mesh>
      <mesh position={[7, 1.2, -14.91]}><boxGeometry args={[3.1, 1.5, 0.01]} /><meshLambertMaterial color="#0a0a0a" /></mesh>
      {/* Wall TV with metrics */}
      <mesh position={[4, 1.3, -14.92]}><boxGeometry args={[1.6, 1.0, 0.04]} /><meshLambertMaterial color="#0a0a0a" /></mesh>
      <mesh position={[4, 1.3, -14.9]}><boxGeometry args={[1.4, 0.85, 0.01]} /><meshLambertMaterial color="#1e3a5f" emissive="#1e40af" emissiveIntensity={0.3} /></mesh>
      <Html position={[4, 1.3, -14.88]} center distanceFactor={8} zIndexRange={[5,0]}>
        <div style={{ color: '#d4af37', fontSize: 12, fontWeight: 900, fontFamily: 'Inter, sans-serif', pointerEvents: 'none', textAlign: 'center' }}>
          <div>Q4 TARGETS</div>
          <div style={{ color: '#10b981', fontSize: 10 }}>$25M Pipeline</div>
          <div style={{ color: '#3b82f6', fontSize: 10 }}>142 Active Deals</div>
        </div>
      </Html>
      {/* Water pitcher + glasses on table */}
      <mesh position={[7, 0.44, -11]}><cylinderGeometry args={[0.05, 0.04, 0.15, 12]} /><meshStandardMaterial color="#93c5fd" transparent opacity={0.4} roughness={0.1} /></mesh>
      {[-0.4, 0, 0.4].map((dx, i) => (
        <mesh key={`glass${i}`} position={[7.3 + dx, 0.44, -11]}><cylinderGeometry args={[0.02, 0.02, 0.06, 8]} /><meshStandardMaterial color="#93c5fd" transparent opacity={0.3} roughness={0.1} /></mesh>
      ))}
      {/* Ceiling lights */}
      {[5, 7, 9].map((x, i) => (
        <mesh key={`brl${i}`} position={[x, 1.88, -11]}><boxGeometry args={[0.1, 0.03, 6]} /><meshLambertMaterial color="#fef3c7" emissive="#d4af37" emissiveIntensity={0.3} /></mesh>
      ))}
      {/* Room label */}
      <Html position={[7, 1.7, -14.88]} center distanceFactor={8} zIndexRange={[5,0]}>
        <div style={{ color: '#d4af37', fontSize: 16, fontWeight: 900, fontFamily: 'Inter, sans-serif', letterSpacing: '0.15em', pointerEvents: 'none' }}>BOARDROOM</div>
      </Html>
    </group>
  );
});

// ─── Server Room ─────────────────────────────────────────────────────────────
function ServerRoom() {
  const rackRefs = useRef<THREE.Mesh[]>([]);
  const darkMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#080810', roughness: 0.8 }), []);
  const goldMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#d4af37', emissive: new THREE.Color('#b8941e'), emissiveIntensity: 0.4, roughness: 0.15, metalness: 0.9 }), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    rackRefs.current.forEach((mesh, i) => {
      if (mesh) {
        (mesh.material as THREE.MeshLambertMaterial).emissiveIntensity =
          0.3 + Math.sin(t * (3 + i * 0.7) + i * 1.5) * 0.4;
      }
    });
  });

  return (
    <group>
      {/* Floor — cool blue tint */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-4, -0.02, -11]}>
        <planeGeometry args={[8, 8]} /><meshStandardMaterial color="#0a0a1a" roughness={0.4} metalness={0.2} />
      </mesh>
      {/* Walls */}
      <mesh position={[-4, 0.9, -15]}><boxGeometry args={[8, 2, 0.08]} /><primitive object={darkMat} attach="material" /></mesh>
      <mesh position={[-8, 0.9, -11]}><boxGeometry args={[0.08, 2, 8]} /><primitive object={darkMat} attach="material" /></mesh>
      <mesh position={[0, 0.9, -11]}><boxGeometry args={[0.08, 2, 8]} /><meshStandardMaterial color="#1e3a5f" transparent opacity={0.3} roughness={0.05} /></mesh>
      {/* Gold accents */}
      <mesh position={[-4, 1.85, -15]}><boxGeometry args={[8, 0.04, 0.09]} /><primitive object={goldMat} attach="material" /></mesh>
      {/* 4 Server racks */}
      {[-6.5, -5, -3.5, -2].map((x, ri) => (
        <group key={`rack${ri}`} position={[x, 0, -13]}>
          <mesh position={[0, 0.8, 0]}><boxGeometry args={[0.7, 1.6, 0.6]} /><meshLambertMaterial color="#0a0a12" /></mesh>
          {/* Blinking LEDs */}
          {[0.2, 0.4, 0.6, 0.8, 1.0, 1.2].map((dy, li) => (
            <mesh
              key={`led${li}`}
              ref={el => { if (el) rackRefs.current[ri * 6 + li] = el; }}
              position={[0.36, dy, 0]}
            >
              <boxGeometry args={[0.02, 0.04, 0.4]} />
              <meshLambertMaterial color={li % 2 === 0 ? '#3b82f6' : '#10b981'} emissive={li % 2 === 0 ? '#1d4ed8' : '#047857'} emissiveIntensity={0.5} />
            </mesh>
          ))}
        </group>
      ))}
      {/* Cable trays on ceiling */}
      {[-6, -4, -2].map((x, i) => (
        <mesh key={`cable${i}`} position={[x, 1.8, -11]}><boxGeometry args={[0.15, 0.04, 8]} /><meshLambertMaterial color="#374151" /></mesh>
      ))}
      {/* Cool blue point lights */}
      <pointLight position={[-4, 1.5, -11]} intensity={0.4} color="#3b82f6" />
      {/* Temperature display */}
      <Html position={[-4, 1.4, -14.92]} center distanceFactor={6} zIndexRange={[5,0]}>
        <div style={{ background: 'rgba(0,0,0,0.9)', borderRadius: 6, padding: '4px 10px', border: '1px solid #06b6d433', pointerEvents: 'none' }}>
          <div style={{ color: '#06b6d4', fontSize: 8, fontWeight: 700, fontFamily: 'monospace' }}>TEMP: 68°F</div>
          <div style={{ color: '#10b981', fontSize: 8, fontWeight: 700, fontFamily: 'monospace' }}>STATUS: OPTIMAL</div>
          <div style={{ color: '#3b82f6', fontSize: 8, fontWeight: 700, fontFamily: 'monospace' }}>UPTIME: 99.97%</div>
        </div>
      </Html>
      {/* RESTRICTED ACCESS sign */}
      <Html position={[-4, 1.7, -7.1]} center distanceFactor={6} zIndexRange={[5,0]}>
        <div style={{ color: '#ef4444', fontSize: 8, fontWeight: 900, fontFamily: 'Inter, sans-serif', letterSpacing: '0.2em', pointerEvents: 'none', background: 'rgba(0,0,0,0.8)', padding: '2px 8px', borderRadius: 3, border: '1px solid #ef444444' }}>
          ⚠ RESTRICTED ACCESS
        </div>
      </Html>
    </group>
  );
}

// ─── Rooftop Lounge ──────────────────────────────────────────────────────────
const RooftopLounge = memo(() => {
  const woodMat = useMemo(() => new THREE.MeshLambertMaterial({ color: '#2a1a00' }), []);
  const metalMat = useMemo(() => new THREE.MeshStandardMaterial({ color: '#6b7280', roughness: 0.3, metalness: 0.6 }), []);

  return (
    <group position={[2, 2.2, 11]}>
      {/* Elevated platform floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.02, 0]}>
        <planeGeometry args={[20, 6]} /><meshStandardMaterial color="#2a1a0a" roughness={0.5} metalness={0.05} />
      </mesh>
      {/* Platform edge/thickness */}
      <mesh position={[0, -0.12, 3]}><boxGeometry args={[20, 0.2, 0.1]} /><meshStandardMaterial color="#1a1a2e" roughness={0.5} /></mesh>
      <mesh position={[0, -0.12, -3]}><boxGeometry args={[20, 0.2, 0.1]} /><meshStandardMaterial color="#1a1a2e" roughness={0.5} /></mesh>
      {/* Stairs from main floor (front-left side) */}
      {[0, 1, 2, 3, 4].map((s, i) => (
        <mesh key={`stair${i}`} position={[-9, -2.2 + i * 0.5, -3.5 - i * 0.4]}>
          <boxGeometry args={[1.5, 0.12, 0.5]} /><meshStandardMaterial color="#1a1a2e" roughness={0.4} />
        </mesh>
      ))}
      {/* Glass railing */}
      {[[-10, 0], [10, 0]].map(([x], i) => (
        <mesh key={`rp${i}`} position={[x, 0.4, 0]}><boxGeometry args={[0.06, 0.8, 6]} /><meshStandardMaterial color="#6b7280" transparent opacity={0.3} roughness={0.1} /></mesh>
      ))}
      <mesh position={[0, 0.4, 3]}><boxGeometry args={[20, 0.8, 0.06]} /><meshStandardMaterial color="#6b7280" transparent opacity={0.3} roughness={0.1} /></mesh>
      {/* Metal railing top bar */}
      <mesh position={[0, 0.8, 3]}><boxGeometry args={[20, 0.03, 0.04]} /><primitive object={metalMat} attach="material" /></mesh>
      <mesh position={[-10, 0.8, 0]}><boxGeometry args={[0.04, 0.03, 6]} /><primitive object={metalMat} attach="material" /></mesh>
      <mesh position={[10, 0.8, 0]}><boxGeometry args={[0.04, 0.03, 6]} /><primitive object={metalMat} attach="material" /></mesh>
      {/* Bar counter */}
      <mesh position={[6, 0.5, -2]}><boxGeometry args={[4, 0.06, 0.8]} /><primitive object={woodMat} attach="material" /></mesh>
      <mesh position={[6, 0.24, -2]}><boxGeometry args={[4, 0.5, 0.78]} /><meshLambertMaterial color="#1a1a2e" /></mesh>
      {/* Bar stools */}
      {[4.5, 5.5, 6.5, 7.5].map((x, i) => (
        <group key={`stool${i}`} position={[x, 0, -1.2]}>
          <mesh position={[0, 0.4, 0]}><cylinderGeometry args={[0.12, 0.12, 0.04, 12]} /><meshLambertMaterial color="#1a1a2e" /></mesh>
          <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.02, 0.02, 0.4, 8]} /><primitive object={metalMat} attach="material" /></mesh>
          <mesh position={[0, 0.02, 0]}><cylinderGeometry args={[0.1, 0.1, 0.03, 8]} /><primitive object={metalMat} attach="material" /></mesh>
        </group>
      ))}
      {/* Lounge chairs */}
      {[[-5, 1], [-3, 1], [-1, 1], [1, 1]].map(([x, z], i) => (
        <group key={`lc${i}`} position={[x, 0, z]}>
          <mesh position={[0, 0.18, 0]}><boxGeometry args={[0.7, 0.06, 1.4]} /><meshStandardMaterial color="#374151" roughness={0.8} /></mesh>
          <mesh position={[0, 0.3, 0.6]} rotation={[-0.3, 0, 0]}><boxGeometry args={[0.7, 0.5, 0.06]} /><meshStandardMaterial color="#374151" roughness={0.8} /></mesh>
        </group>
      ))}
      {/* Potted plants */}
      {[[-8, -2], [8, -2], [-8, 2], [8, 2]].map(([x, z], i) => (
        <group key={`rp${i}`} position={[x, 0, z]}>
          <mesh position={[0, 0.2, 0]}><cylinderGeometry args={[0.15, 0.18, 0.4, 10]} /><meshLambertMaterial color="#1a1a2e" /></mesh>
          <mesh position={[0, 0.55, 0]}><sphereGeometry args={[0.25, 10, 10]} /><meshLambertMaterial color="#065f46" /></mesh>
        </group>
      ))}
      {/* String lights overhead */}
      {[-7, -4, -1, 2, 5, 8].map((x, i) => (
        <group key={`sl${i}`}>
          <mesh position={[x, 1.5, 0]}><sphereGeometry args={[0.04, 6, 6]} /><meshLambertMaterial color="#fef3c7" emissive="#f59e0b" emissiveIntensity={0.8} /></mesh>
          <mesh position={[x, 1.3, 0]}><cylinderGeometry args={[0.003, 0.003, 0.4, 4]} /><meshLambertMaterial color="#6b7280" /></mesh>
        </group>
      ))}
      {/* City skyline backdrop (simple boxes) */}
      {[[-8,3,6],[-5,2.5,5],[-3,4,4],[-1,3.5,7],[1,2.8,5],[3,4.5,4],[5,3,6],[7,3.8,5],[9,2.5,7]].map(([x, h, w], i) => (
        <mesh key={`bldg${i}`} position={[x, h/2 - 0.5, -3.5]}>
          <boxGeometry args={[1.2, h, 0.1]} /><meshStandardMaterial color="#0f172a" emissive="#1e293b" emissiveIntensity={0.1} />
        </mesh>
      ))}
      {/* Building windows (tiny emissive dots) */}
      {[-8, -5, -3, -1, 1, 3, 5, 7, 9].map((x, i) => (
        <group key={`win${i}`}>
          {[0.5, 1, 1.5, 2].map((y, j) => (
            <mesh key={j} position={[x, y - 0.3, -3.44]}><boxGeometry args={[0.15, 0.1, 0.01]} /><meshLambertMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={Math.random() > 0.3 ? 0.6 : 0} /></mesh>
          ))}
        </group>
      ))}
      {/* ROOFTOP sign */}
      <Html position={[0, 1.8, 0]} center distanceFactor={10} zIndexRange={[5,0]}>
        <div style={{ color: '#f59e0b', fontSize: 20, fontWeight: 900, fontFamily: 'Inter, sans-serif', letterSpacing: '0.2em', pointerEvents: 'none', textShadow: '0 0 15px rgba(245,158,11,0.5)' }}>
          ROOFTOP LOUNGE
        </div>
      </Html>
    </group>
  );
});

// ─── Visitor NPCs ────────────────────────────────────────────────────────────
function VisitorNPC({ id, delay }: { id: number; delay: number }) {
  const ref = useRef<THREE.Group>(null!);
  const leftArm = useRef<THREE.Group>(null!);
  const rightArm = useRef<THREE.Group>(null!);
  const leftLeg = useRef<THREE.Group>(null!);
  const rightLeg = useRef<THREE.Group>(null!);
  const phaseRef = useRef<'entering' | 'at_reception' | 'leaving'>('entering');
  const timerRef = useRef(delay);
  const skinColors = ['#e2c898', '#c8956c', '#d4b499', '#fbbf24', '#c49a6c'];
  const suitColors = ['#374151', '#1e3a5f', '#4a1942', '#1a3a2a', '#3a2a1a'];
  const skin = skinColors[id % skinColors.length];
  const suit = suitColors[id % suitColors.length];

  useFrame((state) => {
    if (!ref.current) return;
    const t = state.clock.elapsedTime;
    const delta = 0.016;
    timerRef.current -= delta;

    if (timerRef.current > 0 && phaseRef.current === 'entering') {
      ref.current.visible = false;
      return;
    }
    ref.current.visible = true;

    const cur = ref.current.position;
    if (phaseRef.current === 'entering') {
      // Walk from entrance to reception
      const target = [0, 0, 5.5] as const;
      const dx = target[0] - cur.x;
      const dz = target[2] - cur.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.2) {
        phaseRef.current = 'at_reception';
        timerRef.current = 6 + Math.random() * 8;
      } else {
        cur.x += (dx / dist) * 0.6 * delta;
        cur.z += (dz / dist) * 0.6 * delta;
        ref.current.rotation.y = Math.atan2(dx, dz);
        // Walk animation
        if (leftArm.current) leftArm.current.rotation.x = Math.sin(t * 5) * 0.4;
        if (rightArm.current) rightArm.current.rotation.x = Math.sin(t * 5 + Math.PI) * 0.4;
        if (leftLeg.current) leftLeg.current.rotation.x = Math.sin(t * 5 + Math.PI) * 0.4;
        if (rightLeg.current) rightLeg.current.rotation.x = Math.sin(t * 5) * 0.4;
      }
    } else if (phaseRef.current === 'at_reception') {
      // Stand idle at reception
      if (leftArm.current) leftArm.current.rotation.x = -0.3 + Math.sin(t * 2) * 0.05;
      if (rightArm.current) rightArm.current.rotation.x = -0.3 + Math.sin(t * 2 + 1) * 0.05;
      if (leftLeg.current) leftLeg.current.rotation.x = 0;
      if (rightLeg.current) rightLeg.current.rotation.x = 0;
      if (timerRef.current <= 0) {
        phaseRef.current = 'leaving';
      }
    } else if (phaseRef.current === 'leaving') {
      // Walk back out
      const exit = [0, 0, 9] as const;
      const dx = exit[0] - cur.x;
      const dz = exit[2] - cur.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < 0.2) {
        // Reset — enter again after a delay
        cur.set(0, 0, 8.5);
        phaseRef.current = 'entering';
        timerRef.current = 15 + Math.random() * 20;
      } else {
        cur.x += (dx / dist) * 0.7 * delta;
        cur.z += (dz / dist) * 0.7 * delta;
        ref.current.rotation.y = Math.atan2(dx, dz);
        if (leftArm.current) leftArm.current.rotation.x = Math.sin(t * 5) * 0.4;
        if (rightArm.current) rightArm.current.rotation.x = Math.sin(t * 5 + Math.PI) * 0.4;
        if (leftLeg.current) leftLeg.current.rotation.x = Math.sin(t * 5 + Math.PI) * 0.4;
        if (rightLeg.current) rightLeg.current.rotation.x = Math.sin(t * 5) * 0.4;
      }
    }
  });

  return (
    <group ref={ref} position={[0, 0, 8.5]} visible={false}>
      {/* Simple visitor character — slightly smaller than agents */}
      <mesh position={[0, 1.05, 0]}><sphereGeometry args={[0.12, 16, 16]} /><meshStandardMaterial color={skin} roughness={0.9} /></mesh>
      {/* Eyes */}
      <mesh position={[-0.05, 1.06, 0.1]}><sphereGeometry args={[0.02, 8, 8]} /><meshStandardMaterial color="#ffffff" /></mesh>
      <mesh position={[0.05, 1.06, 0.1]}><sphereGeometry args={[0.02, 8, 8]} /><meshStandardMaterial color="#ffffff" /></mesh>
      <mesh position={[-0.05, 1.06, 0.115]}><sphereGeometry args={[0.01, 6, 6]} /><meshStandardMaterial color="#1f2937" /></mesh>
      <mesh position={[0.05, 1.06, 0.115]}><sphereGeometry args={[0.01, 6, 6]} /><meshStandardMaterial color="#1f2937" /></mesh>
      {/* Hair */}
      <mesh position={[0, 1.15, 0]}><boxGeometry args={[0.24, 0.07, 0.22]} /><meshStandardMaterial color="#2d1f1a" roughness={0.8} /></mesh>
      {/* Body */}
      <mesh position={[0, 0.78, 0]}><capsuleGeometry args={[0.12, 0.2, 8, 16]} /><meshStandardMaterial color={suit} roughness={0.7} /></mesh>
      {/* Arms */}
      <group ref={leftArm} position={[-0.15, 0.84, 0]}>
        <mesh position={[0, -0.15, 0]}><cylinderGeometry args={[0.03, 0.035, 0.3, 8]} /><meshStandardMaterial color={suit} roughness={0.7} /></mesh>
        <mesh position={[0, -0.32, 0]}><sphereGeometry args={[0.03, 8, 8]} /><meshStandardMaterial color={skin} roughness={0.9} /></mesh>
      </group>
      <group ref={rightArm} position={[0.15, 0.84, 0]}>
        <mesh position={[0, -0.15, 0]}><cylinderGeometry args={[0.03, 0.035, 0.3, 8]} /><meshStandardMaterial color={suit} roughness={0.7} /></mesh>
        <mesh position={[0, -0.32, 0]}><sphereGeometry args={[0.03, 8, 8]} /><meshStandardMaterial color={skin} roughness={0.9} /></mesh>
      </group>
      {/* Legs */}
      <group ref={leftLeg} position={[-0.05, 0.65, 0]}>
        <mesh position={[0, -0.18, 0]}><cylinderGeometry args={[0.04, 0.04, 0.35, 8]} /><meshStandardMaterial color="#1e293b" roughness={0.7} /></mesh>
        <mesh position={[0, -0.38, 0.02]}><boxGeometry args={[0.07, 0.05, 0.12]} /><meshStandardMaterial color="#374151" roughness={0.4} /></mesh>
      </group>
      <group ref={rightLeg} position={[0.05, 0.65, 0]}>
        <mesh position={[0, -0.18, 0]}><cylinderGeometry args={[0.04, 0.04, 0.35, 8]} /><meshStandardMaterial color="#1e293b" roughness={0.7} /></mesh>
        <mesh position={[0, -0.38, 0.02]}><boxGeometry args={[0.07, 0.05, 0.12]} /><meshStandardMaterial color="#374151" roughness={0.4} /></mesh>
      </group>
      {/* Visitor label */}
      <Html position={[0, 1.35, 0]} center distanceFactor={5} zIndexRange={[8,0]}>
        <div style={{ background: 'rgba(0,0,0,0.7)', borderRadius: 4, padding: '1px 6px', border: '1px solid rgba(255,255,255,0.1)', pointerEvents: 'none' }}>
          <span style={{ color: '#94a3b8', fontSize: 8, fontFamily: 'Inter, sans-serif' }}>Client #{id + 1}</span>
        </div>
      </Html>
    </group>
  );
}

const Visitors = memo(() => (
  <group>
    <VisitorNPC id={0} delay={3} />
    <VisitorNPC id={1} delay={12} />
    <VisitorNPC id={2} delay={25} />
  </group>
));

// ─── Main Scene ───────────────────────────────────────────────────────────────
function OfficeScene({ isPlaying }: { isPlaying: boolean }) {
  const ambientRef = useRef<THREE.AmbientLight>(null!);
  const sunRef = useRef<THREE.DirectionalLight>(null!);

  // Day/night cycle: 120 second full cycle
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const dayProgress = (Math.sin(t * 0.05) + 1) / 2; // 0 = night, 1 = day

    if (ambientRef.current) {
      ambientRef.current.intensity = 0.12 + dayProgress * 0.4;
      // Night gets a blue tint
      const r = 0.7 + dayProgress * 0.3;
      const g = 0.7 + dayProgress * 0.3;
      const b = 1.0;
      ambientRef.current.color.setRGB(r, g, b);
    }
    if (sunRef.current) {
      sunRef.current.intensity = 0.15 + dayProgress * 0.7;
    }
  });

  return (
    <>
      <ambientLight ref={ambientRef} intensity={0.5} />
      <directionalLight ref={sunRef} position={[10, 15, 10]} intensity={0.8} />
      <directionalLight position={[-19, 15, 0]} intensity={0.6} />
      <directionalLight position={[19, 15, 0]} intensity={0.6} />

      {/* Day/Night clock indicator */}
      <Html position={[11, 2.5, 7]} distanceFactor={8} zIndexRange={[15,0]}>
        <DayNightClock />
      </Html>

      <ExpandedFloor />
      <ExpandedWalls />
      <BrandingWall />
      <LuxuryDecorations />
      <GymRoom />
      <BreakRoom />
      <Boardroom />
      <ServerRoom />
      <RooftopLounge />
      <Visitors />
      <Jukebox isPlaying={isPlaying} />

      {/* Desks */}
      {AGENTS.map(a => (
        a.isBoss
          ? <ExecutiveDesk key={a.id} position={a.desk} />
          : <Desk key={a.id} position={a.desk} />
      ))}

      {/* Agents */}
      {AGENTS.map(a => (
        <AgentCharacter
          key={a.id}
          agentId={a.id}
          name={a.name}
          color={a.color}
          skinColor={a.skinColor}
          status={a.status}
          role={a.role}
          deskPos={a.desk}
          isPlaying={isPlaying}
          isBoss={a.isBoss}
        />
      ))}
    </>
  );
}

// Day/Night clock HUD
function DayNightClock() {
  const [time, setTime] = useState('');
  const [isDay, setIsDay] = useState(true);
  useEffect(() => {
    const interval = setInterval(() => {
      const t = performance.now() / 1000;
      const progress = (Math.sin(t * 0.05) + 1) / 2;
      const hours = Math.floor(progress * 14 + 5); // 5 AM to 7 PM
      const ampm = hours >= 12 ? 'PM' : 'AM';
      const h12 = hours > 12 ? hours - 12 : hours;
      setTime(`${h12}:00 ${ampm}`);
      setIsDay(progress > 0.3);
    }, 500);
    return () => clearInterval(interval);
  }, []);
  return (
    <div style={{ background: 'rgba(0,0,0,0.8)', borderRadius: 8, padding: '4px 10px', border: '1px solid #ffffff15', pointerEvents: 'none', display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontSize: 14 }}>{isDay ? '☀️' : '🌙'}</span>
      <span style={{ color: isDay ? '#fbbf24' : '#93c5fd', fontSize: 11, fontWeight: 700, fontFamily: 'Inter, monospace' }}>{time}</span>
    </div>
  );
}

// ─── Export ───────────────────────────────────────────────────────────────────

const ALL_ROOMS: RoomType[] = ['office', 'gym', 'breakroom', 'boardroom', 'serverroom', 'rooftop'];
const FREE_MAX_AGENTS = 3;

export default function AgentWorkspace({
  agents,
  rooms,
  branding,
  stats,
  dataFeed,
  isPlaying = false,
  onAgentClick,
  className,
  licenseKey,
  theme = 'dark',
}: AgentWorkspaceProps) {
  // License check: pro unlocks all rooms + unlimited agents
  const isPro = !!licenseKey && licenseKey.length > 8;

  // Build agent list from props or defaults
  const agentConfigs = agents || DEFAULT_AGENTS;
  const activeAgents = isPro ? agentConfigs : agentConfigs.slice(0, FREE_MAX_AGENTS);
  const activeRooms = isPro ? (rooms || ALL_ROOMS) : ['office'] as RoomType[];

  const contextValue = useMemo(() => ({
    agents: activeAgents,
    rooms: activeRooms,
    branding: branding || { name: 'Agent HQ', logo: 'AH', color: '#d4af37' },
    isPro,
    onAgentClick,
  }), [activeAgents, activeRooms, branding, isPro, onAgentClick]);

  return (
    <WorkspaceContext.Provider value={contextValue}>
      <div
        className={className}
        style={{
          position: 'relative', minHeight: 400, width: '100%', height: '100%',
          background: theme === 'dark' ? '#0a0a1a' : '#f0f0f5',
          borderRadius: 16, overflow: 'hidden',
          border: '1px solid rgba(212,175,55,0.15)',
          ...(className ? {} : { height: 500 }),
        }}
      >
        <Canvas
          camera={{ position: [0, 22, 30], fov: 50 }}
          style={{ width: '100%', height: '100%' }}
        >
          <OfficeScene isPlaying={isPlaying} />
          <OrbitControls
            enablePan enableZoom enableRotate
            minDistance={5} maxDistance={50}
            maxPolarAngle={Math.PI / 2.1}
          />
        </Canvas>

        {/* Free tier badge */}
        {!isPro && (
          <div style={{
            position: 'absolute', bottom: 12, right: 12, background: 'rgba(0,0,0,0.8)',
            borderRadius: 8, padding: '4px 12px', border: '1px solid rgba(212,175,55,0.3)',
            color: '#d4af37', fontSize: 10, fontWeight: 700, fontFamily: 'Inter, sans-serif',
            letterSpacing: '0.1em', pointerEvents: 'none',
          }}>
            FREE TIER — {FREE_MAX_AGENTS} AGENTS / 1 ROOM
          </div>
        )}
      </div>
    </WorkspaceContext.Provider>
  );
}

export type { AgentConfig, AgentWorkspaceProps, BrandingConfig, RoomType } from './types';


