import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, RoundedBox, useTexture } from '@react-three/drei'
import * as THREE from 'three'

const navItems = [
  { id: 'home', label: 'Home' },
  { id: 'who-am-i', label: 'Who Am I' },
  { id: 'portfolio', label: 'Portfolio' },
  { id: 'contact-me', label: 'Contact Me' },
]

const RING_COUNT = 60
const CARD_LENGTH = 2.2
const CARD_WIDTH = 1.2
const KEN_TARGET_WIDTH = 4.25 // KEN 字樣在 3D 空間中的總寬度

// 以「卡片單位」排版（卡片 2.2 × 1.2）。
// 沿筆畫方向的卡片間距為 2.5，大於卡片長度 2.2，因此卡片之間不會重疊。
function buildKen() {
  const PITCH = 2.5
  const cards = []
  const add = (x, y, deg) => cards.push({ x, y, angle: (deg * Math.PI) / 180 })
  const stem = (x) => [-1.5, -0.5, 0.5, 1.5].forEach((k) => add(x, k * PITCH, 90))

  // K
  stem(0)
  add(2.0, 1.35, 45)
  add(3.77, 3.12, 45)
  add(2.0, -1.35, -45)
  add(3.77, -3.12, -45)

  // E
  stem(7)
  ;[9.0, 11.5].forEach((x) => {
    add(x, 4.25, 0)
    add(x, -4.25, 0)
  })
  add(9.0, 0, 0)

  // N
  stem(14.6)
  stem(21.1)
  ;[-1, 0, 1].forEach((k) => add(17.85 + k * 1.25, -k * 2.165, -60))

  // 以實際外框置中
  const bounds = cards.reduce(
    (b, c) => {
      const cos = Math.abs(Math.cos(c.angle))
      const sin = Math.abs(Math.sin(c.angle))
      const hx = (CARD_LENGTH / 2) * cos + (CARD_WIDTH / 2) * sin
      const hy = (CARD_LENGTH / 2) * sin + (CARD_WIDTH / 2) * cos
      return {
        minX: Math.min(b.minX, c.x - hx),
        maxX: Math.max(b.maxX, c.x + hx),
        minY: Math.min(b.minY, c.y - hy),
        maxY: Math.max(b.maxY, c.y + hy),
      }
    },
    { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity }
  )
  const cx = (bounds.minX + bounds.maxX) / 2
  const cy = (bounds.minY + bounds.maxY) / 2

  return {
    targets: cards.map((c) => ({ ...c, x: c.x - cx, y: c.y - cy })),
    width: bounds.maxX - bounds.minX,
  }
}

const KEN = buildKen()
const KEN_CARD_SCALE = KEN_TARGET_WIDTH / KEN.width

// 浮動幅度（世界座標）：XY 保持很小以免卡片互相碰撞，Z 較大製造深度感
const FLOAT_XY = 0.01
const FLOAT_Z = 0.06
const FLOAT_TILT = 0.04
const tmpEuler = new THREE.Euler()
const tmpQuat = new THREE.Quaternion()
const tmpFaceEuler = new THREE.Euler()
const tmpFaceQuat = new THREE.Quaternion()

// 作品截圖（15 張），對應 public/img/projects
const PROJECT_IMAGES = Array.from(
  { length: 15 },
  (_, i) => `/img/projects/project-${String(i + 1).padStart(2, '0')}.png`
)
// 作品卡片放在盤旋的正中間：60 張的中央 15 張（索引 22–36）
// 作品連結（對應 project-01 ~ project-10），點擊卡片時開新視窗；11 以後沒有連結
const PROJECT_LINKS = [
  'https://www.skytopiahk.com/en',
  'https://www.oceanpark.com.hk/en',
  'https://waterworld.oceanpark.com.hk/en/',
  'https://www.oceanpark.com.hk/tc/a-day-at-the-park/events/halloween-fest-2026',
  'https://estore.bmwhk.com/zh',
  'https://www.hactl.com/en',
  'https://sustainability.hactl.com/en/2025',
  'https://www.stheadline.com/investment/3312868/PayMe%E5%86%8D%E6%8E%A8%E6%90%B6%E5%88%A9%E6%98%AF-%E6%9C%80%E5%A4%9A%E4%BA%AB888%E5%85%83-BoC-Pay%E6%B4%BE%E5%88%A9%E6%98%AF%E9%9A%A8%E6%99%82%E4%B8%AD8888%E5%85%83',
  'https://hkracing-museum-ar.com/en/desktop',
  'https://master.df8ei5w74q1xh.amplifyapp.com/tv/hero-product/',
]
const PROJECT_CARD_INDEXES = Array.from(
  { length: PROJECT_IMAGES.length },
  (_, i) => Math.floor((RING_COUNT - PROJECT_IMAGES.length) / 2) + i
)

// Portfolio 自轉樓梯：中軸偏右，卡片由上往下旋轉堆疊，Z 逐層增加，角度依序 +20°
// 中軸在畫面正中央（x = 0），卡片離中軸固定半徑，繞軸公轉；卡片本身不自轉
const STAIR_RADIUS = 1.8
const STAIR_RADIUS_STEP = -0.01 // 每張卡片的半徑增量（負數＝往下逐漸縮小）
const STAIR_DY = 0.1 // 每張卡片往下的垂直間距；一圈 6 張，每圈下降 0.6（大於卡片高度，上下圈不重疊）
const STAIR_AXIS_X_RATIO = 0.2 // 中軸往右偏移（佔視窗寬度比例）
const STAIR_SPIN_SPEED = 0.2 // 整組繞中軸的速度
const CAM_BASE_POSITION = new THREE.Vector3(0, 0, 4.5) // 預設鏡頭位置（與 Canvas camera 一致）
const CAM_LOW_Y = -1.1 // Portfolio 時鏡頭降低的高度
const CAM_LOOK_Y = 0.6 // Portfolio 時鏡頭看向的高度（高於鏡頭即為仰拍）
const camLook = new THREE.Vector3()
const STAIR_ROTATE_STEP = (38 * Math.PI) / 180 // 每張卡片的角度增量（需足夠大，同圈卡片才不會重疊）

function buildStair() {
  const slots = []
  for (let index = 0; index < RING_COUNT; index += 1) {
    const isProject = PROJECT_CARD_INDEXES.includes(index)
    slots.push({
      y: ((RING_COUNT - 1) / 2 - index) * STAIR_DY,
      radius: STAIR_RADIUS + index * STAIR_RADIUS_STEP,
      rotate: (index + 1) * STAIR_ROTATE_STEP,
      scale: isProject ? 0.42 : 0.36,
      isProject,
    })
  }
  return slots
}

const STAIR_LAYOUT = buildStair()
const STAIR_SLOT_BY_CARD = Array.from({ length: RING_COUNT }, (_, index) => STAIR_LAYOUT[index])

const SCREEN_WIDTH = CARD_LENGTH - 0.16
const SCREEN_HEIGHT = CARD_WIDTH - 0.16
const PARALLAX = 0.06 // 截圖層隨滑鼠移動的幅度
const CARD_TILT_BY_POINTER = 0.12

// 邊緣柔和淡出的遮罩，讓截圖融入卡片而不是硬邊貼圖
let fadeMap = null
function getFadeMap() {
  if (fadeMap) return fadeMap
  const w = 256
  const h = 140
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d')
  const data = ctx.createImageData(w, h)
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const ex = Math.min(x, w - 1 - x) / (w * 0.28)
      const ey = Math.min(y, h - 1 - y) / (h * 0.34)
      const v = THREE.MathUtils.smoothstep(Math.min(ex, ey, 1), 0, 1)
      const i = (y * w + x) * 4
      data.data[i] = data.data[i + 1] = data.data[i + 2] = Math.round(v * 255)
      data.data[i + 3] = 255
    }
  }
  ctx.putImageData(data, 0, 0)
  fadeMap = new THREE.CanvasTexture(canvas)
  return fadeMap
}

// 截圖位於卡片內部（玻璃後方），分兩層給予深度感
function ProjectScreen({ url, screenRef }) {
  const source = useTexture(url)
  const fade = useMemo(() => getFadeMap(), [])

  // 以 cover 方式裁切，避免截圖變形
  const texture = useMemo(() => {
    const map = source.clone()
    map.colorSpace = THREE.SRGBColorSpace
    map.anisotropy = 8
    const imageAspect = map.image.width / map.image.height
    const frameAspect = SCREEN_WIDTH / SCREEN_HEIGHT
    if (imageAspect > frameAspect) {
      map.repeat.set(frameAspect / imageAspect, 1)
      map.offset.set((1 - map.repeat.x) / 2, 0)
    } else {
      map.repeat.set(1, imageAspect / frameAspect)
      map.offset.set(0, (1 - map.repeat.y) / 2)
    }
    map.needsUpdate = true
    return map
  }, [source])

  return (
    <group ref={screenRef} visible={false}>
      {/* 正面：朝 +Z，貼在卡面（卡片半厚 0.055）外側 */}
      <group>
        <mesh position={[0, 0, 0.057]} scale={1.1} renderOrder={4}>
          <planeGeometry args={[SCREEN_WIDTH, SCREEN_HEIGHT]} />
          <meshBasicMaterial
            map={texture}
            alphaMap={fade}
            color="#7f93aa"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, 0, 0.06]} renderOrder={5}>
          <planeGeometry args={[SCREEN_WIDTH, SCREEN_HEIGHT]} />
          <meshBasicMaterial
            map={texture}
            alphaMap={fade}
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
      {/* 背面：旋轉 180°，從另一面看也是正的 */}
      <group rotation={[0, Math.PI, 0]}>
        <mesh position={[0, 0, 0.057]} scale={1.1} renderOrder={4}>
          <planeGeometry args={[SCREEN_WIDTH, SCREEN_HEIGHT]} />
          <meshBasicMaterial
            map={texture}
            alphaMap={fade}
            color="#7f93aa"
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
        <mesh position={[0, 0, 0.06]} renderOrder={5}>
          <planeGeometry args={[SCREEN_WIDTH, SCREEN_HEIGHT]} />
          <meshBasicMaterial
            map={texture}
            alphaMap={fade}
            transparent
            opacity={0}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      </group>
    </group>
  )
}

function BackgroundShape({ activeSection }) {
  const ringRef = useRef(null)
  const cardRefs = useRef([])
  const screenRefs = useRef([])
  const glassRefs = useRef([])
  const pointer = useRef({ tx: 0, ty: 0, x: 0, y: 0 })
  const kenMorphRef = useRef(0)
  const gridMorphRef = useRef(0)
  const { viewport, camera } = useThree()

  // Canvas 設為 pointer-events: none，所以改由 window 取得滑鼠位置
  useEffect(() => {
    const onMove = (event) => {
      pointer.current.tx = (event.clientX / window.innerWidth) * 2 - 1
      pointer.current.ty = -((event.clientY / window.innerHeight) * 2 - 1)
    }
    window.addEventListener('pointermove', onMove)
    return () => window.removeEventListener('pointermove', onMove)
  }, [])

  const pieces = useMemo(() => {
    const helper = new THREE.Object3D()

    return Array.from({ length: RING_COUNT }, (_, index) => {
      const angle = (index / RING_COUNT) * Math.PI * 2
      const radius = 5.5
      const ringPosition = new THREE.Vector3(
        Math.cos(angle) * radius,
        Math.sin(angle) * radius * 0.42,
        Math.sin(angle) * radius * 0.82
      )

      helper.position.copy(ringPosition)
      helper.quaternion.identity()
      helper.lookAt(0, 0, 0)
      helper.rotateY(Math.PI / 2)
      helper.rotateZ(Math.PI * 0.5)
      const ringQuaternion = helper.quaternion.clone()

      const target = KEN.targets[index]
      const inKen = Boolean(target)
      const projectIndex = PROJECT_CARD_INDEXES.indexOf(index)
      const isProject = projectIndex !== -1
      const kenQuaternion = inKen
        ? new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, target.angle))
        : ringQuaternion.clone()

      // 不在 KEN 內的卡片，排成 KEN 時朝四面八方飛出畫面
      const scatterPosition = new THREE.Vector3(
        Math.cos(angle) * 22,
        Math.sin(angle) * 14,
        -Math.abs(Math.sin(angle)) * 6
      )
      const stairSlot = STAIR_SLOT_BY_CARD[index]

      return {
        key: index,
        inKen,
        isProject,
        projectIndex,
        ringPosition,
        ringQuaternion,
        scatterPosition,
        kenPosition: inKen
          ? new THREE.Vector3(target.x * KEN_CARD_SCALE, target.y * KEN_CARD_SCALE, 0)
          : scatterPosition,
        kenQuaternion,
        stairY: stairSlot.y,
        stairRadius: stairSlot.radius,
        stairRotate: stairSlot.rotate,
        stairScale: stairSlot.scale,
        phase: index * 1.7,
        speed: 0.6 + (index % 5) * 0.12,
      }
    })
  }, [])

  // Canvas 是 pointer-events: none，所以用 window 事件 + 射線偵測是否點到作品卡片
  useEffect(() => {
    const raycaster = new THREE.Raycaster()
    const ndc = new THREE.Vector2()

    const pickLink = (event) => {
      // 只在 Portfolio 轉場大致完成後才可點擊；選單、按鈕、連結上不處理
      if (gridMorphRef.current < 0.6) return null
      if (event.target instanceof Element && event.target.closest('a, button, header')) return null

      ndc.set(
        (event.clientX / window.innerWidth) * 2 - 1,
        -((event.clientY / window.innerHeight) * 2 - 1)
      )
      raycaster.setFromCamera(ndc, camera)

      let best = null
      pieces.forEach((piece, index) => {
        if (!piece.isProject) return
        const link = PROJECT_LINKS[piece.projectIndex]
        const card = cardRefs.current[index]
        if (!link || !card || !card.visible) return
        const hit = raycaster.intersectObject(card, true)[0]
        if (hit && (!best || hit.distance < best.distance)) {
          best = { link, distance: hit.distance }
        }
      })
      return best ? best.link : null
    }

    const onClick = (event) => {
      const link = pickLink(event)
      if (link) window.open(link, '_blank', 'noopener,noreferrer')
    }
    const onHover = (event) => {
      document.body.style.cursor = pickLink(event) ? 'pointer' : ''
    }

    window.addEventListener('click', onClick)
    window.addEventListener('pointermove', onHover)
    return () => {
      window.removeEventListener('click', onClick)
      window.removeEventListener('pointermove', onHover)
      document.body.style.cursor = ''
    }
  }, [pieces, camera])

  useFrame((state, delta) => {
    const ring = ringRef.current
    if (!ring) return

    const isWho = activeSection === 'who-am-i'
    const isPortfolio = activeSection === 'portfolio'
    kenMorphRef.current = THREE.MathUtils.damp(kenMorphRef.current, isWho ? 1 : 0, 2.5, delta)
    gridMorphRef.current = THREE.MathUtils.damp(gridMorphRef.current, isPortfolio ? 1 : 0, 2.5, delta)
    const kenMorph = kenMorphRef.current
    const gridMorph = gridMorphRef.current
    const lock = Math.min(1, kenMorph + gridMorph)

    // Portfolio：鏡頭降低、看向較高處，形成由下向上拍
    state.camera.position.set(
      CAM_BASE_POSITION.x,
      THREE.MathUtils.lerp(CAM_BASE_POSITION.y, CAM_LOW_Y, gridMorph),
      CAM_BASE_POSITION.z
    )
    camLook.set(0, THREE.MathUtils.lerp(0, CAM_LOOK_Y, gridMorph), 0)
    state.camera.lookAt(camLook)

    const p = pointer.current
    p.x = THREE.MathUtils.damp(p.x, p.tx, 4, delta)
    p.y = THREE.MathUtils.damp(p.y, p.ty, 4, delta)

    const autoTurn = state.clock.elapsedTime * STAIR_SPIN_SPEED

    // 旋轉：home 維持環狀，自動旋轉；portfolio 改成整體自轉樓梯
    ring.rotation.y = THREE.MathUtils.euclideanModulo(ring.rotation.y + Math.PI, Math.PI * 2) - Math.PI
    if (activeSection === 'home') {
      ring.rotation.y += delta * 0.25
    } else if (isWho || isPortfolio) {
      ring.rotation.y = THREE.MathUtils.damp(ring.rotation.y, 0, 4, delta)
    } else {
      ring.rotation.y += delta * 0.18 * (1 - lock)
    }
    ring.rotation.x = Math.sin(state.clock.elapsedTime * 0.4) * 0.12 * (1 - lock)
    ring.rotation.z = Math.cos(state.clock.elapsedTime * 0.35) * 0.08 * (1 - lock)

    const fit = Math.min(1, viewport.width / (KEN_TARGET_WIDTH + 0.8))
    const { lerp, clamp, smoothstep } = THREE.MathUtils

    pieces.forEach((piece, index) => {
      const card = cardRefs.current[index]
      if (!card) return

      // 注意：home 不再直接重設位置。kenMorph / gridMorph 會平滑降到 0，
      // 卡片自然從 KEN / 樓梯內插回環上，返回時才有動畫。
      const stagger = (index / RING_COUNT) * 0.5
      const tk = smoothstep(clamp(kenMorph * 1.5 - stagger, 0, 1), 0, 1)
      const tg = smoothstep(clamp(gridMorph * 1.5 - stagger, 0, 1), 0, 1)

      // 繞畫面中央的垂直中軸公轉：x / z 由角度決定，y 由上往下
      const theta = piece.stairRotate + autoTurn
      const axisX = viewport.width >= 6 ? viewport.width * STAIR_AXIS_X_RATIO : 0
      const gridX = axisX + Math.sin(theta) * piece.stairRadius
      const gridY = piece.stairY
      const gridZ = Math.cos(theta) * piece.stairRadius
      const gridCardScale = piece.stairScale

      const kenFit = piece.inKen ? fit : 1
      const kenCardScale = piece.inKen ? KEN_CARD_SCALE * fit : 1

      let x = lerp(piece.ringPosition.x, piece.kenPosition.x * kenFit, tk)
      let y = lerp(piece.ringPosition.y, piece.kenPosition.y * kenFit, tk)
      let z = lerp(piece.ringPosition.z, piece.kenPosition.z, tk)
      x = lerp(x, gridX, tg)
      y = lerp(y, gridY, tg)
      z = lerp(z, gridZ, tg)

      // 卡片不自轉：正面（+Z）一律朝向中軸，隨公轉角度同步轉動
      tmpFaceQuat.setFromEuler(tmpFaceEuler.set(0, theta + Math.PI, 0))
      card.quaternion.slerpQuaternions(piece.ringQuaternion, piece.kenQuaternion, tk)
      card.quaternion.slerp(tmpFaceQuat, tg)

      const settle = Math.min(1, tg)
      const time = state.clock.elapsedTime * piece.speed + piece.phase
      x += Math.sin(time * 0.9) * FLOAT_XY * settle
      y += Math.cos(time * 1.1) * FLOAT_XY * settle
      z += Math.sin(time) * FLOAT_Z * settle

      card.position.set(x, y, z)

      const tiltPointer = piece.isProject ? tg * CARD_TILT_BY_POINTER : 0
      tmpEuler.set(
        Math.sin(time * 0.8) * FLOAT_TILT * settle - p.y * tiltPointer,
        Math.cos(time * 1.1) * FLOAT_TILT * settle + p.x * tiltPointer,
        0
      )
      card.quaternion.multiply(tmpQuat.setFromEuler(tmpEuler))

      card.scale.setScalar(lerp(lerp(1, kenCardScale, tk), gridCardScale, tg))
      card.visible = Math.hypot(x, y, z) < 30

      if (piece.isProject) {
        const glass = glassRefs.current[index]
        if (glass) {
          glass.metalness = lerp(1, 0.15, tg)
          glass.roughness = lerp(0.18, 0.05, tg)
          glass.opacity = 1
          glass.emissiveIntensity = lerp(0.12, 0.03, tg)
          glass.depthWrite = true
        }

        const screen = screenRefs.current[piece.projectIndex]
        if (screen) {
          screen.visible = tg > 0.01
          screen.children.forEach((side) => {
            const [deep, shallow] = side.children
            deep.material.opacity = tg * 0.35
            shallow.material.opacity = tg
            deep.position.x = -p.x * PARALLAX
            deep.position.y = -p.y * PARALLAX * 0.6
            shallow.position.x = p.x * PARALLAX * 0.5
            shallow.position.y = p.y * PARALLAX * 0.3
          })
        }
      }
    })
  })

  return (
    <>
      <ambientLight intensity={0.9} />
      <directionalLight position={[3, 2, 4]} intensity={2.8} color="#ffffff" />
      <directionalLight position={[-4, -1, 2]} intensity={1.8} color="#dfe7f2" />
      <spotLight position={[0, 3, 5]} angle={0.5} penumbra={0.8} intensity={35} color="#ffffff" />

      <group ref={ringRef}>
        {pieces.map((piece) => (
          <group
            key={piece.key}
            ref={(el) => {
              cardRefs.current[piece.key] = el
            }}
            position={piece.ringPosition}
            quaternion={piece.ringQuaternion}
          >
            <RoundedBox args={[2.2, 1.2, 0.11]} radius={0.05} smoothness={6} renderOrder={3}>
              <meshPhysicalMaterial
                ref={(el) => {
                  glassRefs.current[piece.key] = el
                }}
                transparent={piece.isProject}
                color="#dfe4ea"
                emissive="#b8c0ca"
                emissiveIntensity={0.12}
                metalness={1}
                roughness={0.18}
                clearcoat={1}
                clearcoatRoughness={0.08}
                reflectivity={1}
              />
            </RoundedBox>
            {piece.isProject && (
              <Suspense fallback={null}>
                <ProjectScreen
                  url={PROJECT_IMAGES[piece.projectIndex]}
                  screenRef={(el) => {
                    screenRefs.current[piece.projectIndex] = el
                  }}
                />
              </Suspense>
            )}
          </group>
        ))}
      </group>

      <Environment preset="city" />
    </>
  )
}

function NavItem({ item, active, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(item.id)}
      className={`relative px-4 py-2 text-[11px] font-medium tracking-[0.2em] uppercase transition-colors duration-200 sm:text-sm ${
        active ? 'text-white' : 'text-white/60 hover:text-white'
      }`}
    >
      <span>{item.label}</span>
      {active && <span className="absolute inset-x-2 -bottom-1 h-px bg-white" />}
    </button>
  )
}

function SectionIntro({ eyebrow, title, description }) {
  return (
    <div className="mb-12 max-w-2xl">
      <p className="mb-4 text-xs font-medium uppercase tracking-[0.32em] text-white/50">
        {eyebrow}
      </p>
      <h2 className="text-4xl font-semibold tracking-[-0.06em] text-white md:text-5xl">
        {title}
      </h2>
      {description && (
        <p className="mt-4 text-base leading-7 text-white/70 md:text-lg">{description}</p>
      )}
    </div>
  )
}

function App() {
  const [activeSection, setActiveSection] = useState('home')
  const sectionRefs = useRef({})

  useEffect(() => {
    const updateActiveSectionByScroll = () => {
      const entries = Object.entries(sectionRefs.current).filter(([, section]) => section)
      if (!entries.length) return

      const viewportTop = 0
      const viewportBottom = window.innerHeight
      let nextId = 'home'
      let bestVisibility = -1

      entries.forEach(([id, section]) => {
        const rect = section.getBoundingClientRect()
        const visibleTop = Math.max(rect.top, viewportTop)
        const visibleBottom = Math.min(rect.bottom, viewportBottom)
        const visibleHeight = Math.max(0, visibleBottom - visibleTop)

        if (visibleHeight <= 0) return

        const centerDelta = Math.abs((rect.top + rect.height / 2) - window.innerHeight * 0.5)
        const visibilityScore = visibleHeight + Math.max(0, 300 - centerDelta)

        if (visibilityScore > bestVisibility) {
          bestVisibility = visibilityScore
          nextId = id
        }
      })

      setActiveSection((current) => (current === nextId ? current : nextId))

      const hash = `#${nextId}`
      if (window.location.hash !== hash) {
        window.history.replaceState(null, '', hash)
      }
    }

    updateActiveSectionByScroll()
    window.addEventListener('scroll', updateActiveSectionByScroll, { passive: true })
    window.addEventListener('resize', updateActiveSectionByScroll)

    return () => {
      window.removeEventListener('scroll', updateActiveSectionByScroll)
      window.removeEventListener('resize', updateActiveSectionByScroll)
    }
  }, [])

  const handleScrollToSection = (id) => {
    const target = sectionRefs.current[id]
    if (!target) return

    const headerOffset = 88
    const targetY = Math.max(0, target.getBoundingClientRect().top + window.scrollY - headerOffset)
    // current 完全交給 scroll 位置判斷，點擊時不強制設定，避免回彈
    window.scrollTo({ top: targetY, behavior: 'smooth' })
  }

  return (
    <div className="relative min-h-screen bg-black text-white antialiased">
      <header className="sticky top-0 z-50 border-b border-white/10 bg-black/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-4 sm:px-6 md:px-10">
          <button
            type="button"
            onClick={() => handleScrollToSection('home')}
            className="text-lg font-semibold uppercase tracking-[0.2em] text-white"
          >
            K.
          </button>

          <nav className="flex items-center gap-1 overflow-x-auto whitespace-nowrap py-1">
            {navItems.map((item) => (
              <NavItem
                key={item.id}
                item={item}
                active={activeSection === item.id}
                onClick={handleScrollToSection}
              />
            ))}
          </nav>
        </div>
      </header>

      <main className="relative z-10">
        <section
          id="home"
          ref={(el) => {
            sectionRefs.current.home = el
          }}
          className="flex min-h-screen items-center px-6 py-20 md:px-10"
        >
          <div className="mx-auto grid w-full max-w-7xl items-center gap-12 md:grid-cols-[1.3fr_0.7fr]">
            <div>
              <p className="text-xs font-medium uppercase tracking-[0.38em] text-white/45">
                Design • Strategy • Storytelling
              </p>
              <h1 className="mt-6 max-w-3xl text-5xl font-semibold tracking-[-0.08em] text-white md:text-7xl">
                I build calm, bold digital experiences.
              </h1>
              <p className="mt-6 max-w-xl text-lg leading-8 text-white/70">
                I’m a multidisciplinary designer focused on meaningful brands, thoughtful interfaces, and launch-ready creative direction.
              </p>
              <div className="mt-8 flex flex-wrap gap-4">
                <button
                  type="button"
                  onClick={() => handleScrollToSection('portfolio')}
                  className="rounded-md border border-white/20 bg-white px-6 py-3 text-sm font-medium uppercase tracking-[0.2em] text-black transition hover:bg-white/90"
                >
                  View Work
                </button>
                <button
                  type="button"
                  onClick={() => handleScrollToSection('contact-me')}
                  className="rounded-md border border-white/20 px-6 py-3 text-sm font-medium uppercase tracking-[0.2em] text-white transition hover:border-white/40 hover:bg-white/5"
                >
                  Let’s Talk
                </button>
              </div>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/[0.03] p-8 shadow-[0_0_80px_rgba(255,255,255,0.04)]">
              <p className="text-xs uppercase tracking-[0.3em] text-white/50">Currently</p>
              <div className="mt-8 space-y-8">
                <div>
                  <p className="text-5xl font-semibold tracking-[-0.08em] text-white">6+</p>
                  <p className="mt-2 text-sm uppercase tracking-[0.2em] text-white/55">Years Experience</p>
                </div>
                <div className="h-px w-full bg-white/10" />
                <div>
                  <p className="text-5xl font-semibold tracking-[-0.08em] text-white">24</p>
                  <p className="mt-2 text-sm uppercase tracking-[0.2em] text-white/55">Projects Shipped</p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="who-am-i"
          ref={(el) => {
            sectionRefs.current['who-am-i'] = el
          }}
          className="flex min-h-screen items-center px-6 py-24 md:px-10"
        >
          <div className="mx-auto w-full max-w-7xl">
            <SectionIntro
              eyebrow="Who Am I"
              title="I turn complex ideas into clear, memorable experiences."
              description="I work across branding, product design, and art direction to help companies communicate with confidence and build trust with their audience."
            />

            <div className="grid gap-8 md:grid-cols-3">
              <div className="rounded-md border border-white/10 bg-white/[0.03] p-6">
                <p className="text-sm uppercase tracking-[0.3em] text-white/50">Approach</p>
                <p className="mt-6 text-xl leading-8 text-white/80">
                  Strategic thinking with a strong eye for clarity, emotion, and usability.
                </p>
              </div>
              <div className="rounded-md border border-white/10 bg-white/[0.03] p-6">
                <p className="text-sm uppercase tracking-[0.3em] text-white/50">Focus</p>
                <p className="mt-6 text-xl leading-8 text-white/80">
                  Brand systems, landing pages, product stories, and polished visual communication.
                </p>
              </div>
              <div className="rounded-md border border-white/10 bg-white/[0.03] p-6">
                <p className="text-sm uppercase tracking-[0.3em] text-white/50">Value</p>
                <p className="mt-6 text-xl leading-8 text-white/80">
                  Simpler decisions, better positioning, and experiences that feel premium and intuitive.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section
          id="portfolio"
          ref={(el) => {
            sectionRefs.current.portfolio = el
          }}
          className="min-h-[100vh] px-6 pt-24 md:px-10"
        >
          <div className="mx-auto w-full max-w-7xl">
            <SectionIntro
              eyebrow="Portfolio"
              title="Selected work shaped around clarity and impact."
              description="A collection of design systems, digital launches, and brand experiences built to move both attention and action."
            />

            <div aria-hidden="true" className="h-[40vh] md:hidden" />
          </div>
        </section>

        <section
          id="contact-me"
          ref={(el) => {
            sectionRefs.current['contact-me'] = el
          }}
          className="flex min-h-screen items-center px-6 py-24 md:px-10"
        >
          <div className="mx-auto w-full max-w-5xl rounded-lg border border-white/10 bg-white/[0.03] p-8 md:p-12">
            <SectionIntro
              eyebrow="Contact Me"
              title="Available for new projects, collaborations, and conversations."
              description="If you’re building something thoughtful and want creative support from strategy to delivery, let’s connect."
            />

            <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-2xl font-medium tracking-[-0.04em] text-white md:text-3xl">
                  hello@yourportfolio.com
                </p>
                <p className="mt-3 text-white/60">Based in Taipei · Open for remote work</p>
              </div>

              <a
                href="mailto:hello@yourportfolio.com"
                className="inline-flex items-center justify-center rounded-md border border-white/20 bg-white px-6 py-3 text-sm font-medium uppercase tracking-[0.2em] text-black transition hover:bg-white/90"
              >
                Email Me
              </a>
            </div>
          </div>
        </section>
      </main>

      <Canvas
        camera={{ position: [0, 0, 4.5], fov: 45 }}
        gl={{ antialias: true, alpha: true }}
        style={{
          position: 'fixed',
          inset: 0,
          width: '100vw',
          height: '100vh',
          zIndex: 0,
          pointerEvents: 'none',
          background: 'transparent',
        }}
      >
        <BackgroundShape activeSection={activeSection} />
      </Canvas>
    </div>
  )
}

export default App
