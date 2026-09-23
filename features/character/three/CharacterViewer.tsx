'use client'

// Trình hiển thị nhân vật 3D (GLB). Chỉ tải ở client qua next/dynamic (ssr: false) để three.js không vào bundle chính.
// Chuẩn asset: docs/NHAN_VAT_3D.md — xương theo tên Mixamo, vật liệu "tint"/"tint2"/"skin"/"hair".
import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { ContactShadows, Environment, Lightformer, OrbitControls, useAnimations, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js'
import { bodyUrl, normalizeBone, type AnimationName, type Gender, type Slot } from '../model/catalog'

export interface ViewerItem {
  slot: Slot
  url: string
  color: string | null
  color2: string | null
}

export interface CharacterViewerProps {
  gender: Gender
  skinTone: string
  hairColor: string
  items: ViewerItem[]
  animation?: AnimationName
  /** Cho xoay bằng tay (tủ đồ); tắt ở thẻ nhỏ để không chặn cuộn trang */
  interactive?: boolean
  /** Khung hình: cả người hoặc chân dung (đầu + vai) */
  framing?: 'full' | 'portrait'
  className?: string
  fallback?: ReactNode
}

type Bones = Map<string, THREE.Object3D>

/** Đổi màu vật liệu theo quy ước tên; clone để không đụng vào bản gốc trong cache */
function paint(obj: THREE.Object3D, colors: { tint?: string | null; tint2?: string | null; skin?: string; hair?: string }) {
  obj.traverse((o) => {
    const m = o as THREE.Mesh
    if (!m.isMesh) return
    const apply = (mat: THREE.Material) => {
      const c = mat.name === 'tint' ? colors.tint : mat.name === 'tint2' ? colors.tint2
        : mat.name === 'skin' ? colors.skin : mat.name === 'hair' ? colors.hair : null
      if (!c) return mat
      const copy = mat.clone() as THREE.MeshStandardMaterial
      copy.color = new THREE.Color(c)
      return copy
    }
    m.material = Array.isArray(m.material) ? m.material.map(apply) : apply(m.material)
    m.castShadow = true
  })
}

/** Gắn một món đồ vào xương của thân: mesh có skin thì buộc lại vào bộ xương thân; mesh thường gắn theo tên node */
function attachItem(scene: THREE.Object3D, bones: Bones, root: THREE.Object3D): THREE.Object3D[] {
  const attached: THREE.Object3D[] = []
  const skinned: THREE.SkinnedMesh[] = []
  scene.traverse((o) => { if ((o as THREE.SkinnedMesh).isSkinnedMesh) skinned.push(o as THREE.SkinnedMesh) })
  for (const sm of skinned) {
    const mapped = sm.skeleton.bones.map((b) => (bones.get(normalizeBone(b.name)) as THREE.Bone | undefined) ?? b)
    sm.bind(new THREE.Skeleton(mapped, sm.skeleton.boneInverses), sm.bindMatrix)
    root.add(sm)
    attached.push(sm)
  }
  // Node thường: tìm các nhóm đặt tên theo xương (bỏ qua lớp bọc "Item"/"Scene")
  let level: THREE.Object3D[] = [...scene.children]
  while (level.length === 1 && !bones.has(normalizeBone(level[0].name)) && level[0].children.length) level = [...level[0].children]
  for (const node of level) {
    if ((node as THREE.SkinnedMesh).isSkinnedMesh || attached.includes(node)) continue
    const target = bones.get(normalizeBone(node.name)) ?? root
    target.add(node)
    attached.push(node)
  }
  return attached
}

function ItemPart({ item, bones, root, hasHat, skinTone, hairColor }: {
  item: ViewerItem; bones: Bones; root: THREE.Object3D; hasHat: boolean; skinTone: string; hairColor: string
}) {
  const gltf = useGLTF(item.url, false)
  useEffect(() => {
    const scene = cloneSkinned(gltf.scene)
    paint(scene, { tint: item.color, tint2: item.color2, skin: skinTone, hair: hairColor })
    // Quy ước: phần tóc tên "hide_hat_*" (vd. tóc dựng) ẩn khi đội mũ
    if (hasHat) scene.traverse((o) => { if (o.name.startsWith('hide_hat_')) o.visible = false })
    const parts = attachItem(scene, bones, root)
    return () => { for (const p of parts) p.removeFromParent() }
  }, [gltf, bones, root, item.color, item.color2, hasHat, skinTone, hairColor])
  return null
}

function Character({ gender, skinTone, hairColor, items, animation = 'Idle' }: CharacterViewerProps) {
  const body = useGLTF(bodyUrl(gender), false)
  const group = useRef<THREE.Group>(null)
  const root = useMemo(() => cloneSkinned(body.scene), [body])
  const bones = useMemo(() => {
    const m: Bones = new Map()
    root.traverse((o) => m.set(normalizeBone(o.name), o))
    return m
  }, [root])
  useEffect(() => { paint(root, { skin: skinTone, hair: hairColor }) }, [root, skinTone, hairColor])

  const { actions } = useAnimations(body.animations, group)
  useEffect(() => {
    const a = actions[animation] ?? actions.Idle
    a?.reset().fadeIn(0.25).play()
    return () => { a?.fadeOut(0.25) }
  }, [actions, animation])

  const hasHat = items.some((i) => i.slot === 'hat')
  return (
    <group ref={group}>
      <primitive object={root} />
      {items.map((it) => (
        <Suspense key={`${it.slot}:${it.url}`} fallback={null}>
          <ItemPart item={it} bones={bones} root={root} hasHat={hasHat} skinTone={skinTone} hairColor={hairColor} />
        </Suspense>
      ))}
    </group>
  )
}

class GlBoundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(e: unknown) { console.warn('[Nhân vật 3D] Không hiển thị được:', e) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas')
    return !!(c.getContext('webgl2') || c.getContext('webgl'))
  } catch {
    return false
  }
}

export default function CharacterViewer(props: CharacterViewerProps) {
  const { interactive = false, framing = 'full', className, fallback = null } = props
  const [ok] = useState(() => webglAvailable())
  if (!ok) return <>{fallback}</>
  const portrait = framing === 'portrait'
  return (
    <div className={className} style={{ touchAction: interactive ? 'pan-y' : 'auto' }}>
      <GlBoundary fallback={fallback}>
        <Canvas dpr={[1, 2]} gl={{ antialias: true, alpha: true, powerPreference: 'low-power' }}
          camera={portrait ? { position: [0, 1.52, 1.35], fov: 30 } : { position: [0, 1.0, 3.7], fov: 29 }}
          onCreated={({ camera }) => camera.lookAt(0, portrait ? 1.5 : 0.88, 0)}>
          <ambientLight intensity={0.35} />
          <directionalLight position={[2.5, 4, 3]} intensity={1.6} />
          <directionalLight position={[-3, 2, -2]} intensity={0.6} color="#b6ff3b" />
          <Environment resolution={128}>
            <Lightformer intensity={2.2} position={[0, 3, 4]} scale={[6, 3, 1]} />
            <Lightformer intensity={0.8} position={[-4, 1, 0]} rotation-y={Math.PI / 2} scale={[4, 3, 1]} />
            <Lightformer intensity={0.6} color="#7c9cff" position={[4, 1, -2]} rotation-y={-Math.PI / 2} scale={[4, 3, 1]} />
          </Environment>
          <Suspense fallback={null}>
            <Character {...props} />
          </Suspense>
          {!portrait && <ContactShadows position={[0, 0, 0]} opacity={0.55} scale={3} blur={2.4} far={1.2} />}
          {interactive && (
            <OrbitControls enablePan={false} enableZoom={false} target={[0, portrait ? 1.5 : 0.88, 0]}
              minPolarAngle={Math.PI / 2.6} maxPolarAngle={Math.PI / 1.9} rotateSpeed={0.7} />
          )}
        </Canvas>
      </GlBoundary>
    </div>
  )
}

/** Tải trước mô hình (vd. khi người dùng lướt qua vật phẩm) */
export const preloadModel = (url: string) => useGLTF.preload(url, false)
