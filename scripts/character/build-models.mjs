// Dựng bộ mô hình 3D khởi đầu cho nhân vật RaceHub (GLB) theo chuẩn trong docs/NHAN_VAT_3D.md.
//
//   node scripts/character/build-models.mjs        → public/models/character/*.glb + manifest.json
//
// Đây là bộ asset tạm để app chạy được ngay: thân nam/nữ, tóc, áo, quần, tất, giày, mũ, kính, đồng hồ,
// phụ kiện. Họa sĩ 3D có thể thay từng file bằng bản đẹp hơn, miễn giữ đúng chuẩn:
//   * Y hướng lên, mặt nhân vật nhìn về +Z, đơn vị mét, cao ~1,73 m, bàn chân chạm y = 0
//   * Tên xương theo Mixamo (Hips, Spine, Spine1, Spine2, Neck, Head, LeftArm, LeftForeArm, LeftHand, LeftUpLeg,
//     LeftLeg, LeftFoot, ...). Có hay không có tiền tố "mixamorig:" đều được.
//   * Mỗi món đồ là một GLB: node gốc đặt tên đúng xương cần gắn (vd. "Head" cho mũ); vật liệu tên "tint" / "tint2"
//     được app đổi màu theo vật phẩm, "skin" theo màu da, "hair" theo màu tóc.
import fs from 'node:fs'
import path from 'node:path'
import * as THREE from 'three'
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js'
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js'

// GLTFExporter cần FileReader (chỉ có trong trình duyệt)
globalThis.FileReader = class {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then((b) => { this.result = b; this.onloadend?.() }) }
  readAsDataURL(blob) {
    blob.arrayBuffer().then((b) => {
      this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(b).toString('base64')}`
      this.onloadend?.()
    })
  }
}

const OUT = path.resolve('public/models/character')
fs.mkdirSync(OUT, { recursive: true })

/* ------------------------------------------------------------------ */
/* Vật liệu: tên vật liệu là "hợp đồng" với app (tint/tint2/skin/hair) */
/* ------------------------------------------------------------------ */
const mat = (name, color, opts = {}) => new THREE.MeshStandardMaterial({ name, color, roughness: 0.62, metalness: 0, ...opts })
const M = {
  skin: () => mat('skin', '#e9b995', { roughness: 0.55 }),
  hair: () => mat('hair', '#2b1d16', { roughness: 0.5, side: THREE.DoubleSide }),
  tint: () => mat('tint', '#2f6bff', { roughness: 0.58 }),
  tint2: () => mat('tint2', '#c8ff3b', { roughness: 0.5 }),
  white: () => mat('white', '#f4f6f8', { roughness: 0.7 }),
  sole: () => mat('sole', '#f2f2ee', { roughness: 0.8 }),
  dark: () => mat('dark', '#1d2128', { roughness: 0.55 }),
  eye: () => mat('eye', '#2a1a12', { roughness: 0.25 }),
  eyeWhite: () => mat('eye_white', '#ffffff', { roughness: 0.3 }),
  brow: () => mat('hair', '#2b1d16', { roughness: 0.6 }),
  lip: () => mat('lip', '#c97a6d', { roughness: 0.5 }),
  blush: () => mat('blush', '#f08a8a', { roughness: 0.9, transparent: true, opacity: 0.35 }),
  lens: () => mat('lens', '#15161a', { roughness: 0.08, metalness: 0.6 }),
  metal: () => mat('metal', '#c9ced6', { roughness: 0.3, metalness: 0.85 }),
  gold: () => mat('gold', '#f3c44b', { roughness: 0.3, metalness: 0.9 }),
  glow: () => mat('glow', '#b6ff3b', { emissive: '#b6ff3b', emissiveIntensity: 1.2, roughness: 0.4, transparent: true, opacity: 0.85 }),
}

/* ------------------------------------------------------------------ */
/* Hình học                                                            */
/* ------------------------------------------------------------------ */
const SEG = 28

/** Tiện xoay quanh trục Y từ hàm bán kính r(y), y chạy từ y0 → y1. inflate: nới ra (dùng cho quần áo). */
function lathe(rFn, y0, y1, { inflate = 0, steps = 18, sx = 1, sz = 1, szFn = null, capBottom = false, capTop = false, phi = [0, Math.PI * 2] } = {}) {
  const pts = []
  if (capBottom) pts.push(new THREE.Vector2(0.0001, y0))
  for (let i = 0; i <= steps; i++) {
    const y = y0 + ((y1 - y0) * i) / steps
    pts.push(new THREE.Vector2(Math.max(0.0005, rFn(y) + inflate), y))
  }
  if (capTop) pts.push(new THREE.Vector2(0.0001, y1))
  const g = new THREE.LatheGeometry(pts, SEG, phi[0], phi[1])
  g.scale(sx, 1, sz)
  if (szFn) {                                    // độ dày thay đổi theo chiều cao (ngực, lưng)
    const p = g.attributes.position
    for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) * szFn(p.getY(i)))
  }
  // Gộp đỉnh trùng ở đường nối để pháp tuyến mượt (không lộ sọc dọc)
  g.deleteAttribute('uv')
  g.deleteAttribute('normal')
  const smooth = mergeVertices(g, 1e-5)
  smooth.computeVertexNormals()
  return smooth
}

/** Nội suy mượt giữa các mốc [[y, r], ...] (y tăng dần) */
function curve(stops) {
  return (y) => {
    if (y <= stops[0][0]) return stops[0][1]
    for (let i = 1; i < stops.length; i++) {
      const [ya, ra] = stops[i - 1], [yb, rb] = stops[i]
      if (y <= yb) { const t = (y - ya) / (yb - ya); const s = t * t * (3 - 2 * t); return ra + (rb - ra) * s }
    }
    return stops[stops.length - 1][1]
  }
}

const ellipsoid = (rx, ry, rz, w = 24, h = 16) => { const g = new THREE.SphereGeometry(1, w, h); g.scale(rx, ry, rz); return g }
const mesh = (geo, material, name, pos, rot) => {
  const m = new THREE.Mesh(geo, material)
  m.name = name
  if (pos) m.position.set(...pos)
  if (rot) m.rotation.set(...rot)
  return m
}
/* ------------------------------------------------------------------ */
/* Cơ thể theo giới tính: số đo (m), hàm bán kính từng đoạn            */
/* ------------------------------------------------------------------ */
function bodySpec(gender) {
  const f = gender === 'female'
  const k = f ? 0.93 : 1                          // chiều cao tương đối
  return {
    gender, f,
    hipsY: 0.93 * k,
    spine: [0.09 * k, 0.10 * k, 0.11 * k],        // Hips→Spine→Spine1→Spine2
    neck: 0.13 * k, head: 0.07 * k,
    shoulderX: f ? 0.045 : 0.05, armX: f ? 0.12 : 0.14, shoulderY: 0.10 * k,
    upperArm: 0.27 * k, foreArm: 0.24 * k, armSpread: f ? 0.1 : 0.12,
    legX: f ? 0.078 : 0.074, thigh: 0.42 * k, shin: 0.40 * k,
    // Thân: bán kính theo chiều rộng (x); độ dày z = sz
    torso: curve(f
      ? [[-0.1, 0.115], [-0.02, 0.105], [0.06, 0.112], [0.17, 0.135], [0.25, 0.138], [0.29, 0.12], [0.33, 0.06], [0.345, 0.04]]
      : [[-0.1, 0.125], [0.0, 0.128], [0.1, 0.148], [0.2, 0.168], [0.27, 0.17], [0.31, 0.14], [0.35, 0.065], [0.365, 0.045]]),
    torsoSz: 1, torsoTop: f ? 0.345 : 0.365,
    torsoZ: curve(f ? [[-0.1, 0.66], [0.06, 0.62], [0.15, 0.78], [0.21, 0.8], [0.27, 0.66], [0.33, 0.7]]
                    : [[-0.1, 0.6], [0.08, 0.6], [0.18, 0.7], [0.25, 0.68], [0.31, 0.62], [0.36, 0.7]]),
    pelvis: curve(f ? [[-0.155, 0.03], [-0.12, 0.12], [-0.06, 0.162], [0.02, 0.158], [0.09, 0.12]] : [[-0.15, 0.03], [-0.115, 0.115], [-0.05, 0.148], [0.03, 0.145], [0.09, 0.128]]),
    pelvisSz: f ? 0.72 : 0.68,
    upperArmR: curve([[-0.27, 0.036], [-0.2, 0.04], [-0.08, 0.047], [0, 0.05]].map(([y, r]) => [y * k, r * (f ? 0.84 : 1)])),
    foreArmR: curve([[-0.24, 0.028], [-0.18, 0.031], [-0.06, 0.038], [0, 0.036]].map(([y, r]) => [y * k, r * (f ? 0.84 : 1)])),
    thighR: curve([[-0.42, 0.054], [-0.3, 0.064], [-0.12, 0.076], [-0.03, 0.08], [0.02, 0.06]].map(([y, r]) => [y * k, r * (f ? 1.02 : 1)])),
    shinR: curve([[-0.4, 0.036], [-0.33, 0.04], [-0.2, 0.056], [-0.1, 0.062], [0, 0.056]].map(([y, r]) => [y * k, r * (f ? 0.93 : 1)])),
    headR: curve([[0, 0.055], [0.03, 0.095], [0.08, 0.124], [0.14, 0.135], [0.2, 0.128], [0.25, 0.1], [0.285, 0.05], [0.3, 0.001]]),
    headSz: 1.06,
  }
}

/* ------------------------------------------------------------------ */
/* Bộ xương (tên theo Mixamo, không tiền tố)                          */
/* ------------------------------------------------------------------ */
function buildSkeleton(s) {
  const bones = {}
  const node = (name, parent, pos, rot) => {
    const o = new THREE.Object3D()
    o.name = name
    o.position.set(...pos)
    if (rot) o.rotation.set(...rot)
    if (parent) parent.add(o)
    bones[name] = o
    return o
  }
  const root = node('Root', null, [0, 0, 0])
  const hips = node('Hips', root, [0, s.hipsY, 0])
  const spine = node('Spine', hips, [0, s.spine[0], 0])
  const spine1 = node('Spine1', spine, [0, s.spine[1], 0])
  const spine2 = node('Spine2', spine1, [0, s.spine[2], 0])
  const neck = node('Neck', spine2, [0, s.neck, 0])
  node('Head', neck, [0, s.head, 0])
  for (const [side, sign] of [['Left', 1], ['Right', -1]]) {
    const sh = node(`${side}Shoulder`, spine2, [sign * s.shoulderX, s.shoulderY, 0])
    const arm = node(`${side}Arm`, sh, [sign * s.armX, 0, 0], [0, 0, sign * s.armSpread])
    const fore = node(`${side}ForeArm`, arm, [0, -s.upperArm, 0])
    node(`${side}Hand`, fore, [0, -s.foreArm, 0])
    const up = node(`${side}UpLeg`, hips, [sign * s.legX, -0.04, 0])
    const leg = node(`${side}Leg`, up, [0, -s.thigh, 0])
    const foot = node(`${side}Foot`, leg, [0, -s.shin, 0])
    node(`${side}ToeBase`, foot, [0, -0.05, 0.11])
  }
  return { root, bones }
}

/* ------------------------------------------------------------------ */
/* Cơ thể                                                              */
/* ------------------------------------------------------------------ */
function buildBody(gender) {
  const s = bodySpec(gender)
  const { root, bones } = buildSkeleton(s)
  const skin = M.skin()
  const add = (bone, obj) => bones[bone].add(obj)

  // Thân + hông + cổ
  add('Spine', mesh(lathe(s.torso, -0.1, s.torsoTop, { szFn: s.torsoZ, capTop: true }), skin, 'torso'))
  add('Hips', mesh(lathe(s.pelvis, -0.155, 0.09, { sz: s.pelvisSz, capBottom: true }), skin, 'pelvis'))
  add('Neck', mesh(lathe(curve([[-0.04, s.f ? 0.05 : 0.062], [0.02, s.f ? 0.04 : 0.052], [s.head + 0.02, s.f ? 0.039 : 0.05]]), -0.04, s.head + 0.02), skin, 'neck'))

  // Đầu + mặt
  const head = bones.Head
  head.add(mesh(lathe(s.headR, 0, 0.3, { sz: s.headSz, capBottom: true }), skin, 'head', [0, 0.005, 0]))
  const faceZ = 0.135 * s.headSz
  for (const x of [-1, 1]) {
    head.add(mesh(ellipsoid(0.02, 0.027, 0.012), M.eye(), 'eye', [x * 0.046, 0.128, faceZ - 0.006]))
    head.add(mesh(ellipsoid(0.0065, 0.0065, 0.004), M.eyeWhite(), 'eye_hl', [x * 0.046 + 0.006, 0.137, faceZ + 0.003]))
    const brow = new THREE.CapsuleGeometry(0.005, 0.03, 4, 8)
    head.add(mesh(brow, M.brow(), 'brow', [x * 0.048, 0.168, faceZ - 0.012], [0, 0, Math.PI / 2 + x * (s.f ? -0.12 : -0.05)]))
    head.add(mesh(ellipsoid(0.018, 0.03, 0.014), skin, 'ear', [x * 0.133, 0.115, -0.005]))
    head.add(mesh(ellipsoid(0.02, 0.013, 0.004), M.blush(), 'blush', [x * 0.072, 0.085, faceZ - 0.022], [0, x * 0.45, 0]))
  }
  head.add(mesh(ellipsoid(0.013, 0.016, 0.014), skin, 'nose', [0, 0.1, faceZ + 0.004]))
  head.add(mesh(new THREE.TorusGeometry(0.022, 0.0045, 8, 20, Math.PI * 0.75), M.lip(), 'mouth', [0, 0.072, faceZ - 0.016], [0, 0, Math.PI + Math.PI * 0.125]))

  // Tay
  for (const side of ['Left', 'Right']) {
    add(`${side}Arm`, mesh(ellipsoid(0.051 * (s.f ? 0.86 : 1), 0.055, 0.05 * (s.f ? 0.86 : 1)), skin, 'shoulder', [-(side === 'Left' ? 1 : -1) * 0.008, -0.012, 0]))
    add(`${side}Arm`, mesh(lathe(s.upperArmR, -s.upperArm, 0), skin, 'upper_arm'))
    add(`${side}ForeArm`, mesh(ellipsoid(0.037, 0.037, 0.037), skin, 'elbow'))
    add(`${side}ForeArm`, mesh(lathe(s.foreArmR, -s.foreArm, 0), skin, 'fore_arm'))
    const sign = side === 'Left' ? 1 : -1
    add(`${side}Hand`, mesh(ellipsoid(0.03, 0.058, 0.02), skin, 'hand', [0, -0.05, 0.004]))
    add(`${side}Hand`, mesh(new THREE.CapsuleGeometry(0.011, 0.028, 4, 8), skin, 'thumb', [-sign * 0.018, -0.03, 0.02], [0.4, 0, -sign * 0.5]))
    // Chân
    add(`${side}UpLeg`, mesh(lathe(s.thighR, -s.thigh, 0.02, { capTop: true }), skin, 'thigh'))
    add(`${side}Leg`, mesh(ellipsoid(0.058, 0.06, 0.058), skin, 'knee'))
    add(`${side}Leg`, mesh(lathe(s.shinR, -s.shin, 0), skin, 'shin'))
    add(`${side}Foot`, mesh(ellipsoid(0.045, 0.034, 0.105), skin, 'foot', [0, -0.036, 0.05]))
  }

  root.userData = { gender, height: 1.73 }
  return { root, bones, s }
}

/* ------------------------------------------------------------------ */
/* Hoạt ảnh (Idle / Run / Wave) — nhắm vào tên xương                  */
/* ------------------------------------------------------------------ */
function clips(s, bones) {
  const rest = (n) => bones[n].quaternion.clone()
  const qe = (n, x = 0, y = 0, z = 0) => rest(n).multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)))
  const track = (n, times, eulers) => new THREE.QuaternionKeyframeTrack(`${n}.quaternion`, times,
    eulers.flatMap(([x, y, z]) => qe(n, x, y, z).toArray()))
  const posY = (n, times, ys) => new THREE.VectorKeyframeTrack(`${n}.position`, times,
    ys.flatMap((y) => [bones[n].position.x, bones[n].position.y + y, bones[n].position.z]))

  // Idle 3 giây: thở, tay đung đưa nhẹ, đầu nghiêng
  const T = [0, 1.5, 3]
  const idle = new THREE.AnimationClip('Idle', 3, [
    track('Spine1', T, [[0, 0, 0], [-0.025, 0, 0], [0, 0, 0]]),
    track('Spine2', T, [[0, 0, 0], [-0.02, 0, 0], [0, 0, 0]]),
    track('Head', [0, 1, 2, 3], [[0, 0, 0], [0.03, 0.08, 0.02], [0.02, -0.05, -0.02], [0, 0, 0]]),
    track('LeftArm', T, [[0, 0, 0], [0.04, 0, 0.03], [0, 0, 0]]),
    track('RightArm', T, [[0, 0, 0], [0.04, 0, -0.03], [0, 0, 0]]),
    track('LeftForeArm', T, [[0.12, 0, 0], [0.18, 0, 0], [0.12, 0, 0]]),
    track('RightForeArm', T, [[0.12, 0, 0], [0.18, 0, 0], [0.12, 0, 0]]),
    posY('Hips', T, [0, -0.004, 0]),
  ])

  // Run: chu kỳ 0,7 giây
  const P = 0.7, t = [0, P / 4, P / 2, (3 * P) / 4, P]
  const legSwing = 0.7, kneeBend = 1.25, armSwing = 0.75
  const run = new THREE.AnimationClip('Run', P, [
    track('LeftUpLeg', t, [[-legSwing, 0, 0], [0, 0, 0], [legSwing * 0.8, 0, 0], [0.1, 0, 0], [-legSwing, 0, 0]]),
    track('RightUpLeg', t, [[legSwing * 0.8, 0, 0], [0.1, 0, 0], [-legSwing, 0, 0], [0, 0, 0], [legSwing * 0.8, 0, 0]]),
    track('LeftLeg', t, [[0.35, 0, 0], [kneeBend, 0, 0], [0.25, 0, 0], [0.5, 0, 0], [0.35, 0, 0]]),
    track('RightLeg', t, [[0.25, 0, 0], [0.5, 0, 0], [0.35, 0, 0], [kneeBend, 0, 0], [0.25, 0, 0]]),
    track('LeftFoot', t, [[-0.2, 0, 0], [0.3, 0, 0], [0.1, 0, 0], [0, 0, 0], [-0.2, 0, 0]]),
    track('RightFoot', t, [[0.1, 0, 0], [0, 0, 0], [-0.2, 0, 0], [0.3, 0, 0], [0.1, 0, 0]]),
    track('LeftArm', t, [[armSwing, 0, -0.05], [0, 0, 0], [-armSwing, 0, -0.05], [0, 0, 0], [armSwing, 0, -0.05]]),
    track('RightArm', t, [[-armSwing, 0, 0.05], [0, 0, 0], [armSwing, 0, 0.05], [0, 0, 0], [-armSwing, 0, 0.05]]),
    track('LeftForeArm', t, [[-1.45, 0, 0], [-1.35, 0, 0], [-1.25, 0, 0], [-1.35, 0, 0], [-1.45, 0, 0]]),
    track('RightForeArm', t, [[-1.25, 0, 0], [-1.35, 0, 0], [-1.45, 0, 0], [-1.35, 0, 0], [-1.25, 0, 0]]),
    track('Spine', t, [[0.12, 0.12, 0], [0.12, 0, 0], [0.12, -0.12, 0], [0.12, 0, 0], [0.12, 0.12, 0]]),
    track('Head', t, [[-0.1, -0.06, 0], [-0.1, 0, 0], [-0.1, 0.06, 0], [-0.1, 0, 0], [-0.1, -0.06, 0]]),
    posY('Hips', t, [-0.03, 0.02, -0.03, 0.02, -0.03]),
  ])

  // Wave: vẫy tay chào (1,6 giây)
  const W = [0, 0.3, 0.55, 0.8, 1.05, 1.3, 1.6]
  const up = [-0.2, 0, -2.5]
  const wave = new THREE.AnimationClip('Wave', 1.6, [
    track('RightArm', W, [[0, 0, 0], up, up, up, up, up, [0, 0, 0]]),
    track('RightForeArm', W, [[0, 0, 0], [0, 0, 0.5], [0, 0, 0.1], [0, 0, 0.6], [0, 0, 0.1], [0, 0, 0.5], [0, 0, 0]]),
    track('Head', W, [[0, 0, 0], [0, -0.15, 0.08], [0, -0.15, 0.08], [0, -0.15, 0.08], [0, -0.15, 0.08], [0, -0.1, 0.05], [0, 0, 0]]),
    track('Spine2', W, [[0, 0, 0], [0, 0, 0.05], [0, 0, 0.05], [0, 0, 0.05], [0, 0, 0.05], [0, 0, 0.03], [0, 0, 0]]),
  ])
  return [idle, run, wave]
}

/* ------------------------------------------------------------------ */
/* Vật phẩm: mỗi món = một nhóm node đặt tên theo xương cần gắn      */
/* ------------------------------------------------------------------ */
function item(slot, parts) {
  const root = new THREE.Object3D()
  root.name = 'Item'
  root.userData = { slot }
  const groups = {}
  for (const [bone, obj] of parts) {
    if (!groups[bone]) { groups[bone] = new THREE.Object3D(); groups[bone].name = bone; root.add(groups[bone]) }
    groups[bone].add(obj)
  }
  return root
}

function tops(s) {
  const t = M.tint(), t2 = M.tint2()
  const torso = (y0, y1, inflate = 0.012) => mesh(lathe(s.torso, y0, y1, { inflate, szFn: (y) => s.torsoZ(y) + 0.02 }), t, 'shirt')
  const sleeve = (side, len, inflate = 0.013) => [
    [`${side}Arm`, mesh(ellipsoid(0.062 * (s.f ? 0.86 : 1), 0.064, 0.061 * (s.f ? 0.86 : 1)), t, 'sleeve_cap', [-(side === 'Left' ? 1 : -1) * 0.008, -0.01, 0])],
    [`${side}Arm`, mesh(lathe(s.upperArmR, -len, 0, { inflate }), t, 'sleeve')],
  ]
  const stripe = (y) => ['Spine', mesh(lathe(s.torso, y, y + 0.018, { inflate: 0.016, szFn: (y) => s.torsoZ(y) + 0.025 }), t2, 'stripe')]
  const neckTrim = (y) => ['Spine', mesh(new THREE.TorusGeometry(0.06, 0.008, 8, 24), t2, 'collar', [0, y, 0], [Math.PI / 2, 0, 0])]
  const top = s.torsoTop - 0.015
  return {
    tee: item('top', [['Spine', torso(-0.09, top)], ...sleeve('Left', 0.12), ...sleeve('Right', 0.12), neckTrim(top - 0.008), stripe(0.16)]),
    singlet: item('top', [['Spine', torso(-0.09, top - 0.02)], stripe(0.02)]),
    longsleeve: item('top', [['Spine', torso(-0.09, top)], ...sleeve('Left', s.upperArm),
      ...sleeve('Right', s.upperArm), ...['Left', 'Right'].map((sd) => [`${sd}ForeArm`, mesh(lathe(s.foreArmR, -s.foreArm + 0.02, 0.01, { inflate: 0.011 }), t, 'sleeve_lower')]),
      neckTrim(top - 0.008)]),
    crop: item('top', [['Spine', torso(0.1, top - 0.03, 0.01)], stripe(0.1)]),
    jacket: item('top', [['Spine', torso(-0.1, top, 0.022)], ...sleeve('Left', s.upperArm, 0.02), ...sleeve('Right', s.upperArm, 0.02),
      ...['Left', 'Right'].map((sd) => [`${sd}ForeArm`, mesh(lathe(s.foreArmR, -s.foreArm + 0.02, 0.01, { inflate: 0.018 }), t, 'sleeve_lower')]),
      ['Spine', mesh(new THREE.BoxGeometry(0.012, s.torsoTop + 0.08, 0.01), t2, 'zip', [0, s.torsoTop / 2 - 0.06, s.torso(0.15) * (s.torsoZ(0.15) + 0.02) + 0.02])],
      ['Spine', mesh(new THREE.TorusGeometry(0.065, 0.016, 8, 24), t, 'collar', [0, top, 0], [Math.PI / 2, 0, 0])]]),
  }
}

function bottoms(s) {
  const t = M.tint(), t2 = M.tint2()
  const pelvis = (inflate = 0.012) => ['Hips', mesh(lathe(s.pelvis, -0.155, 0.095, { inflate, sz: s.pelvisSz + 0.03, capBottom: true }), t, 'pants')]
  const leg = (side, len, inflate, flare = 0) => [`${side}UpLeg`,
    mesh(lathe((y) => s.thighR(y) + flare * Math.min(1, -y / len) + 0.012 * Math.max(0, 1 + y / 0.06), -len, 0.03, { inflate, capTop: true }), t, 'pant_leg')]
  const waist = ['Hips', mesh(lathe(s.pelvis, 0.07, 0.095, { inflate: 0.016, sz: s.pelvisSz + 0.035 }), t2, 'waistband')]
  // Đũng quần: lấp khe chữ V giữa hai ống
  const crotch = (drop) => ['Hips', mesh(ellipsoid(0.105, 0.06, 0.085), t, 'crotch', [0, -0.11 - drop, 0])]
  const splitTrim = (side, len, flare) => [`${side}UpLeg`, mesh(lathe((y) => s.thighR(y) + flare, -len, -len + 0.012, { inflate: 0.022 }), t2, 'hem')]
  return {
    shorts: item('bottom', [pelvis(), crotch(0.02), leg('Left', 0.19, 0.018, 0.02), leg('Right', 0.19, 0.018, 0.02), waist, splitTrim('Left', 0.19, 0.02), splitTrim('Right', 0.19, 0.02)]),
    split: item('bottom', [pelvis(), crotch(0.01), leg('Left', 0.12, 0.016, 0.018), leg('Right', 0.12, 0.016, 0.018), waist, splitTrim('Left', 0.12, 0.018), splitTrim('Right', 0.12, 0.018)]),
    tights: item('bottom', [pelvis(0.007), leg('Left', s.thigh + 0.02, 0.007), leg('Right', s.thigh + 0.02, 0.007), waist,
      ...['Left', 'Right'].map((sd) => [`${sd}Leg`, mesh(lathe(s.shinR, -s.shin + 0.05, 0.02, { inflate: 0.006 }), t, 'tight_lower')]),
      ...['Left', 'Right'].map((sd) => [`${sd}Leg`, mesh(ellipsoid(0.063, 0.065, 0.063), t, 'tight_knee')])]),
    capri: item('bottom', [pelvis(0.007), leg('Left', s.thigh + 0.02, 0.007), leg('Right', s.thigh + 0.02, 0.007), waist,
      ...['Left', 'Right'].map((sd) => [`${sd}Leg`, mesh(lathe(s.shinR, -0.17, 0.02, { inflate: 0.006 }), t, 'tight_lower')]),
      ...['Left', 'Right'].map((sd) => [`${sd}Leg`, mesh(ellipsoid(0.063, 0.065, 0.063), t, 'tight_knee')])]),
  }
}

function socks(s) {
  const t = M.tint(), t2 = M.tint2()
  const sock = (side, h) => [
    [`${side}Leg`, mesh(lathe(s.shinR, -s.shin, -s.shin + h, { inflate: 0.004 }), t, 'sock')],
    [`${side}Leg`, mesh(lathe(s.shinR, -s.shin + h - 0.012, -s.shin + h, { inflate: 0.006 }), t2, 'sock_band')],
    [`${side}Foot`, mesh(ellipsoid(0.049, 0.038, 0.109), t, 'sock_foot', [0, -0.036, 0.05])],
  ]
  return {
    crew: item('socks', [...sock('Left', 0.13), ...sock('Right', 0.13)]),
    ankle: item('socks', [...sock('Left', 0.045), ...sock('Right', 0.045)]),
    compression: item('socks', [...sock('Left', 0.3), ...sock('Right', 0.3)]),
  }
}

function shoes() {
  const shoe = (side, { sole = 0.022, plate = false } = {}) => {
    const t = M.tint(), t2 = M.tint2(), so = M.sole()
    const parts = [
      [`${side}Foot`, mesh(ellipsoid(0.056, 0.048, 0.125), t, 'upper', [0, -0.03, 0.05])],
      [`${side}Foot`, mesh(ellipsoid(0.05, 0.035, 0.06), t, 'heel_counter', [0, -0.025, -0.035])],
      [`${side}Foot`, mesh(new THREE.CylinderGeometry(1, 1, sole, 28).scale(0.062, 1, 0.135), so, 'sole', [0, -0.07 + sole / 2 - 0.004, 0.048])],
      [`${side}Foot`, mesh(new THREE.BoxGeometry(0.004, 0.014, 0.1), t2, 'swoosh', [side === 'Left' ? 0.054 : -0.054, -0.035, 0.055], [0.35, 0, 0])],
      [`${side}Foot`, mesh(new THREE.CylinderGeometry(0.043, 0.047, 0.03, 20), t2, 'collar', [0, 0.008, -0.01])],
    ]
    if (plate) parts.push([`${side}Foot`, mesh(new THREE.CylinderGeometry(1, 1, 0.008, 28).scale(0.064, 1, 0.137), t2, 'plate', [0, -0.07 + sole * 0.55, 0.048])])
    return parts
  }
  return {
    runner: item('shoes', [...shoe('Left'), ...shoe('Right')]),
    racer: item('shoes', [...shoe('Left', { sole: 0.04, plate: true }), ...shoe('Right', { sole: 0.04, plate: true })]),
  }
}

function hats(s) {
  const t = M.tint(), t2 = M.tint2()
  const hr = s.headR
  const dome = (inflate) => mesh(lathe(hr, 0.155, 0.3, { inflate, sz: s.headSz + 0.04, capTop: true }), t, 'dome')
  return {
    cap: item('hat', [['Head', dome(0.03)],
      ['Head', mesh(new THREE.CylinderGeometry(1, 1, 0.01, 28, 1, false, -Math.PI / 2, Math.PI).scale(0.125, 1, 0.11), t2, 'brim', [0, 0.18, 0.135], [0.2, 0, 0])],
      ['Head', mesh(ellipsoid(0.013, 0.009, 0.013), t2, 'button', [0, 0.33, 0])]]),
    visor: item('hat', [
      ['Head', mesh(lathe(hr, 0.17, 0.205, { inflate: 0.03, sz: s.headSz + 0.045 }), t, 'band')],
      ['Head', mesh(new THREE.CylinderGeometry(1, 1, 0.008, 28, 1, false, -Math.PI / 2, Math.PI).scale(0.125, 1, 0.11), t2, 'brim', [0, 0.182, 0.135], [0.22, 0, 0])]]),
    headband: item('hat', [['Head', mesh(lathe(hr, 0.17, 0.205, { inflate: 0.026, sz: s.headSz + 0.04 }), t, 'band')],
      ['Head', mesh(lathe(hr, 0.184, 0.191, { inflate: 0.03, sz: s.headSz + 0.045 }), t2, 'band_stripe')]]),
    beanie: item('hat', [['Head', mesh(lathe(hr, 0.15, 0.3, { inflate: 0.034, sz: s.headSz + 0.05, capTop: true }), t, 'beanie')],
      ['Head', mesh(lathe(hr, 0.15, 0.185, { inflate: 0.042, sz: s.headSz + 0.06 }), t2, 'fold')],
      ['Head', mesh(ellipsoid(0.032, 0.032, 0.032), t2, 'pompom', [0, 0.345, 0])]]),
  }
}

function glasses(s) {
  const faceZ = 0.135 * s.headSz
  const R = 0.17, cz = faceZ + 0.03 - R
  const band = (h, arc, material, name, y) => mesh(new THREE.CylinderGeometry(R, R, h, 36, 1, true, -arc / 2, arc), material, name, [0, y, cz])
  const frame = (lensMat, h = 0.06) => [
    ['Head', band(h, Math.PI * 0.46, lensMat, 'lens', 0.128)],
    ['Head', mesh(new THREE.CylinderGeometry(R + 0.003, R + 0.003, 0.01, 36, 1, true, -Math.PI * 0.24, Math.PI * 0.48), M.tint(), 'frame', [0, 0.128 + h / 2, cz])],
    ['Head', mesh(new THREE.BoxGeometry(0.005, 0.007, 0.15), M.tint(), 'arm', [0.142, 0.14, -0.01])],
    ['Head', mesh(new THREE.BoxGeometry(0.005, 0.007, 0.15), M.tint(), 'arm', [-0.142, 0.14, -0.01])],
  ]
  return {
    shield: item('glasses', frame(M.lens())),
    mirror: item('glasses', frame(mat('tint2', '#6ad1ff', { roughness: 0.05, metalness: 0.9 }), 0.052)),
  }
}

function watches(s) {
  const y = -s.foreArm + 0.035
  const band = (r) => mesh(new THREE.CylinderGeometry(r, r, 0.018, 24, 1, true), M.tint(), 'band', [0, y, 0])
  return {
    sport: item('watch', [['LeftForeArm', band(0.0335)],
      ['LeftForeArm', mesh(new THREE.CylinderGeometry(0.018, 0.018, 0.01, 24), M.dark(), 'case', [0.034, y, 0], [0, 0, Math.PI / 2])],
      ['LeftForeArm', mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.002, 24), M.tint2(), 'screen', [0.04, y, 0], [0, 0, Math.PI / 2])]]),
    classic: item('watch', [['LeftForeArm', band(0.0335)],
      ['LeftForeArm', mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.01, 24), M.metal(), 'case', [0.034, y, 0], [0, 0, Math.PI / 2])],
      ['LeftForeArm', mesh(new THREE.CylinderGeometry(0.017, 0.017, 0.002, 24), M.white(), 'screen', [0.04, y, 0], [0, 0, Math.PI / 2])]]),
  }
}

function accessories(s) {
  const front = s.torso(0.12) * (s.torsoZ(0.12) + 0.02) + 0.028
  return {
    bib: item('accessory', [
      ['Spine', mesh(new THREE.BoxGeometry(0.15, 0.11, 0.004), M.white(), 'bib', [0, 0.1, front], [-0.08, 0, 0])],
      ['Spine', mesh(new THREE.BoxGeometry(0.15, 0.022, 0.005), M.tint(), 'bib_band', [0, 0.143, front + 0.002], [-0.08, 0, 0])],
      ['Spine', mesh(new THREE.BoxGeometry(0.09, 0.035, 0.005), M.dark(), 'bib_number', [0, 0.095, front + 0.002], [-0.08, 0, 0])]]),
    medal: item('accessory', [
      ...[-1, 1].map((x) => ['Spine', mesh(new THREE.BoxGeometry(0.022, 0.2, 0.003), M.tint(), 'ribbon', [x * 0.04, 0.2, front - 0.004], [-0.12, 0, x * 0.35])]),
      ['Spine', mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.006, 28), M.gold(), 'medal', [0, 0.1, front + 0.004], [Math.PI / 2 - 0.1, 0, 0])],
      ['Spine', mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.008, 28), M.tint2(), 'medal_face', [0, 0.1, front + 0.007], [Math.PI / 2 - 0.1, 0, 0])]]),
    vest: item('accessory', [
      ['Spine', mesh(lathe(s.torso, 0.05, s.torsoTop - 0.03, { inflate: 0.024, szFn: (y) => s.torsoZ(y) + 0.05 }), M.tint(), 'vest')],
      ['Spine', mesh(new THREE.CapsuleGeometry(0.05, 0.12, 6, 12).scale(1.2, 1, 0.55), M.tint2(), 'bottle_pack', [0, 0.17, -(s.torso(0.17) * (s.torsoZ(0.17) + 0.02) + 0.035)])]]),
    armband: item('accessory', [
      ['RightArm', mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.05, 24, 1, true), M.tint(), 'armband', [0, -0.13, 0])],
      ['RightArm', mesh(new THREE.BoxGeometry(0.006, 0.075, 0.04), M.dark(), 'phone', [-0.052, -0.13, 0])]]),
  }
}

function hair(s) {
  const h = M.hair()
  const hr = s.headR
  const faceZ = 0.135 * s.headSz
  /** Chỏm tóc: nghiêng lên ở trán để lộ mặt */
  const cap = (y0, inflate, tilt = 0.28) => {
    const g = lathe(hr, y0, 0.31, { inflate, sz: s.headSz + 0.035, capTop: true })
    g.translate(0, -0.14, 0); g.rotateX(-tilt); g.translate(0, 0.14, 0)
    return mesh(g, h, 'hair')
  }
  /** Phần tóc sau gáy / hai bên (không phủ mặt) */
  const back = (y0, y1, cover = 0.56, inflate = 0.02) =>     // cover: phần vòng đầu được phủ, tính từ sau gáy
    mesh(lathe(hr, y0, y1, { inflate, sz: s.headSz + 0.04, phi: [Math.PI * (1 - cover), Math.PI * 2 * cover] }), h, 'hair_back')
  /** Mái liền phía trước trán (tên bắt đầu "hide_hat_" → app ẩn khi đội mũ) */
  const bang = (y0, width = 0.62, inflate = 0.02, sweep = 0) => {
    const g = lathe(hr, y0, 0.265, { inflate, sz: s.headSz + 0.045, phi: [-Math.PI * width / 2 + sweep, Math.PI * width], steps: 10 })
    return mesh(g, h, 'bang')
  }
  return {
    short: item('hair', [['Head', cap(0.15, 0.013)], ['Head', bang(0.195, 0.5, 0.02, 0.15)], ['Head', back(0.08, 0.2)]]),
    spiky: item('hair', [['Head', cap(0.16, 0.01, 0.2)], ...Array.from({ length: 10 }, (_, i) => {
      const a = (i / 10) * Math.PI * 2
      return ['Head', mesh(new THREE.ConeGeometry(0.032, 0.085, 8), h, 'hide_hat_spike', [Math.sin(a) * 0.075, 0.295, Math.cos(a) * 0.075], [Math.cos(a) * 0.55, 0, -Math.sin(a) * 0.55])]
    }), ['Head', back(0.09, 0.2)]]),
    buzz: item('hair', [['Head', cap(0.15, 0.004, 0.18)], ['Head', back(0.09, 0.2, 0.56, 0.006)]]),
    ponytail: item('hair', [['Head', cap(0.14, 0.015)], ['Head', bang(0.185, 0.56, 0.021, -0.2)], ['Head', back(0.07, 0.21, 0.62)],
      ['Head', mesh(new THREE.TorusGeometry(0.022, 0.009, 8, 16), M.tint(), 'scrunchie', [0, 0.215, -0.15], [0.5, 0, 0])],
      ['Head', mesh(lathe(curve([[-0.32, 0.004], [-0.24, 0.03], [-0.12, 0.046], [0, 0.028]]), -0.32, 0, { steps: 14 }), h, 'tail', [0, 0.215, -0.16], [-0.32, 0, 0])]]),
    bob: item('hair', [['Head', cap(0.14, 0.018)], ['Head', bang(0.18, 0.7, 0.024)],
      ['Head', mesh(lathe(curve([[0.0, 0.15], [0.06, 0.158], [0.14, 0.155], [0.22, 0.135]]), 0.0, 0.22, { sz: s.headSz + 0.06, phi: [Math.PI * 0.36, Math.PI * 1.28] }), h, 'bob_side', [0, 0, -0.01])]]),
  }
}

function effects() {
  return {
    aura: item('effect', [['Root', mesh(new THREE.TorusGeometry(0.34, 0.012, 8, 64), M.glow(), 'aura_ring', [0, 0.01, 0], [Math.PI / 2, 0, 0])],
      ['Root', mesh(new THREE.TorusGeometry(0.26, 0.006, 8, 64), M.glow(), 'aura_ring2', [0, 0.012, 0], [Math.PI / 2, 0, 0])]]),
  }
}

/* ------------------------------------------------------------------ */
/* Xuất                                                                */
/* ------------------------------------------------------------------ */
const exporter = new GLTFExporter()
const exportGlb = (obj, animations = []) => new Promise((resolve, reject) =>
  exporter.parse(obj, (r) => resolve(Buffer.from(r)), reject, { binary: true, animations, onlyVisible: true }))

const manifest = { version: 1, generated: new Date().toISOString(), bodies: {}, items: [] }
let total = 0
async function write(name, obj, animations) {
  const buf = await exportGlb(obj, animations)
  fs.writeFileSync(path.join(OUT, name), buf)
  total += buf.length
  return `/models/character/${name}`
}

for (const gender of ['male', 'female']) {
  const { root, bones, s } = buildBody(gender)
  manifest.bodies[gender] = await write(`body_${gender}.glb`, root, clips(s, bones))
  const groups = { top: tops(s), bottom: bottoms(s), socks: socks(s), shoes: shoes(s), hat: hats(s), glasses: glasses(s),
    watch: watches(s), accessory: accessories(s), hair: hair(s), effect: effects(s) }
  for (const [slot, list] of Object.entries(groups)) {
    for (const [id, obj] of Object.entries(list)) {
      const file = `${slot}_${id}_${gender}.glb`
      manifest.items.push({ slot, id, gender, url: await write(file, obj) })
    }
  }
}
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2))
console.log(`Đã xuất ${manifest.items.length + 2} file GLB, tổng ${(total / 1024).toFixed(0)} KB → ${OUT}`)
