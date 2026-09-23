'use client';

import React, { useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Center } from '@react-three/drei';
import type { Group } from 'three';
import type {
  CharacterAvatarData,
  CharacterEquipmentData,
  EquipmentRarity,
} from '../model/characterTypes';

interface RunnerAvatarProps {
  avatar?: CharacterAvatarData;
  equipment?: CharacterEquipmentData;
}

// Màu da theo skinTone
const SKIN_TONE_COLOR: Record<string, string> = {
  light: '#f2d3b8',
  tan: '#e0ac7c',
  medium: '#c88a5c',
  dark: '#8a5a3b',
  deep: '#5c3a26',
};

// Màu trang bị theo độ hiếm (rarity) - càng hiếm càng nổi
const RARITY_COLOR: Record<EquipmentRarity, string> = {
  common: '#94a3b8',
  rare: '#38bdf8',
  epic: '#a855f7',
  legendary: '#f97316',
};

/**
 * Nhân vật chạy bộ dạng chibi (đầu to, thân ngắn), dựng hoàn toàn bằng
 * primitive geometry — giữ nguyên vẹn code gốc của anh.
 */
function RunnerAvatar({ avatar, equipment }: RunnerAvatarProps) {
  const root = useRef<Group>(null);
  const leftLeg = useRef<Group>(null);
  const rightLeg = useRef<Group>(null);
  const leftArm = useRef<Group>(null);
  const rightArm = useRef<Group>(null);

  const skinColor = SKIN_TONE_COLOR[avatar?.skinTone ?? 'medium'];
  const jerseyColor = RARITY_COLOR[equipment?.top?.rarity ?? 'common'];
  const shortsColor = RARITY_COLOR[equipment?.bottom?.rarity ?? 'common'];
  const shoeColor = RARITY_COLOR[equipment?.shoes?.rarity ?? 'common'];
  const capColor = equipment?.head ? RARITY_COLOR[equipment.head.rarity] : null;
  const backpackColor = equipment?.backpack
    ? RARITY_COLOR[equipment.backpack.rarity]
    : null;
  const accessoryColor = equipment?.accessory
    ? RARITY_COLOR[equipment.accessory.rarity]
    : null;

  // Chu kỳ chạy: tay chân vung ngược pha nhau, người nảy nhẹ theo nhịp bước.
  useFrame((state) => {
    const t = state.clock.getElapsedTime() * 6;
    const swing = Math.sin(t) * 0.7;

    if (leftLeg.current) leftLeg.current.rotation.x = swing;
    if (rightLeg.current) rightLeg.current.rotation.x = -swing;
    if (leftArm.current) leftArm.current.rotation.x = -swing * 0.8;
    if (rightArm.current) rightArm.current.rotation.x = swing * 0.8;

    if (root.current) {
      root.current.position.y = Math.abs(Math.sin(t)) * 0.06;
      root.current.rotation.z = Math.sin(t) * 0.03;
    }
  });

  return (
    <group ref={root} scale={1.3} position={[0, -0.9, 0]}>
      {/* Đầu */}
      <group position={[0, 1.35, 0]}>
        <mesh castShadow>
          <sphereGeometry args={[0.32, 24, 24]} />
          <meshStandardMaterial color={skinColor} />
        </mesh>
        {capColor && (
          <mesh position={[0, 0.2, 0.05]} rotation={[-0.15, 0, 0]}>
            <coneGeometry args={[0.34, 0.22, 24]} />
            <meshStandardMaterial color={capColor} />
          </mesh>
        )}
      </group>

      {/* Thân trên / áo */}
      <mesh position={[0, 0.85, 0]} castShadow>
        <capsuleGeometry args={[0.26, 0.5, 4, 12]} />
        <meshStandardMaterial color={jerseyColor} />
      </mesh>

      {backpackColor && (
        <mesh position={[0, 0.9, -0.28]} castShadow>
          <boxGeometry args={[0.3, 0.4, 0.16]} />
          <meshStandardMaterial color={backpackColor} />
        </mesh>
      )}

      {accessoryColor && (
        <mesh position={[0.3, 0.65, 0.05]}>
          <torusGeometry args={[0.07, 0.02, 8, 16]} />
          <meshStandardMaterial color={accessoryColor} />
        </mesh>
      )}

      {/* Hông / quần short */}
      <mesh position={[0, 0.45, 0]}>
        <capsuleGeometry args={[0.24, 0.14, 4, 12]} />
        <meshStandardMaterial color={shortsColor} />
      </mesh>

      {/* Tay trái */}
      <group ref={leftArm} position={[-0.32, 0.95, 0]}>
        <mesh position={[0, -0.22, 0]}>
          <capsuleGeometry args={[0.07, 0.34, 4, 8]} />
          <meshStandardMaterial color={skinColor} />
        </mesh>
      </group>
      {/* Tay phải */}
      <group ref={rightArm} position={[0.32, 0.95, 0]}>
        <mesh position={[0, -0.22, 0]}>
          <capsuleGeometry args={[0.07, 0.34, 4, 8]} />
          <meshStandardMaterial color={skinColor} />
        </mesh>
      </group>

      {/* Chân trái */}
      <group ref={leftLeg} position={[-0.13, 0.32, 0]}>
        <mesh position={[0, -0.24, 0]}>
          <capsuleGeometry args={[0.09, 0.36, 4, 8]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <mesh position={[0, -0.46, 0.05]}>
          <boxGeometry args={[0.14, 0.09, 0.22]} />
          <meshStandardMaterial color={shoeColor} />
        </mesh>
      </group>
      {/* Chân phải */}
      <group ref={rightLeg} position={[0.13, 0.32, 0]}>
        <mesh position={[0, -0.24, 0]}>
          <capsuleGeometry args={[0.09, 0.36, 4, 8]} />
          <meshStandardMaterial color="#334155" />
        </mesh>
        <mesh position={[0, -0.46, 0.05]}>
          <boxGeometry args={[0.14, 0.09, 0.22]} />
          <meshStandardMaterial color={shoeColor} />
        </mesh>
      </group>
    </group>
  );
}

interface CharacterCanvasProps {
  avatar?: CharacterAvatarData;
  equipment?: CharacterEquipmentData;
}

export default function CharacterCanvas({ avatar, equipment }: CharacterCanvasProps) {
  const level = avatar?.level ?? 1;

  return (
    <div className="relative w-full max-w-xs mx-auto h-56 bg-gradient-to-b from-surface via-bg to-brand/10 rounded-3xl border border-brand/30 shadow-2xl overflow-hidden flex flex-col items-center">
      {/* Header thông tin nhanh trên Canvas */}
      <div className="absolute top-3 left-4 right-4 flex justify-between items-center z-10">
        <span className="text-xs font-black uppercase tracking-wider text-brand bg-surface/80 px-2.5 py-1 rounded-full border border-border">
          3D Runner Studio
        </span>
        <span className="text-xs font-black bg-brand text-brand-fg px-2.5 py-1 rounded-full shadow-md">
          LV.{level}
        </span>
      </div>

      {/* Môi trường không gian 3D Three.js Canvas */}
      <div className="w-full h-full cursor-grab active:cursor-grabbing">
        <Canvas camera={{ position: [0, 0, 4], fov: 50 }}>
          <ambientLight intensity={0.7} />
          <directionalLight position={[5, 5, 5]} intensity={1.2} />
          <pointLight position={[-5, -5, -5]} intensity={0.5} />
          <Center>
            <RunnerAvatar avatar={avatar} equipment={equipment} />
          </Center>
          <OrbitControls 
            enableZoom={false} 
            maxPolarAngle={Math.PI / 2 + 0.1} 
            minPolarAngle={Math.PI / 4} 
          />
        </Canvas>
      </div>

      {/* Footer chú thích hướng dẫn tương tác */}
      <div className="absolute bottom-2 text-xs text-fg-muted font-medium tracking-wide bg-bg/80 px-3 py-0.5 rounded-full border border-border">
        🖱️ Xoay để xem nhân vật 3D đa chiều
      </div>
    </div>
  );
}