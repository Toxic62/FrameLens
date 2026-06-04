import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  GridHelper,
  InstancedMesh,
  Matrix4,
  MeshLambertMaterial,
  NearestFilter,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createBlockAssetKey } from '@shared/assets'
import type { BlockFaceTextures, BlockModelElement, ModelUv, RenderMode, ResolvedBlockAsset } from '@shared/assets'
import type { LoadedStructure, RenderableBlock, StructureDimensions } from '@shared/structure'
import { getBlockKey } from '@shared/viewer'

export interface ViewportCommand {
  readonly type: 'fit' | 'reset'
  readonly id: number
}

interface StructureViewportProps {
  readonly structure: LoadedStructure | undefined
  readonly visibleBlocks: readonly RenderableBlock[]
  readonly selectedBlockKey: string | null
  readonly highlightedBlockKeys: readonly string[]
  readonly renderMode: RenderMode
  readonly blockAssets: Readonly<Record<string, ResolvedBlockAsset>>
  readonly viewportCommand: ViewportCommand | null
  readonly onSelectBlock: (block: RenderableBlock | null) => void
}

interface BlockMeshRecord {
  readonly mesh: InstancedMesh
  readonly instanceBlocks: readonly RenderableBlock[]
}

interface ViewportState {
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly renderer: WebGLRenderer
  readonly controls: OrbitControls
  blockMeshes: readonly BlockMeshRecord[]
  structureDimensions: StructureDimensions
  renderPaused: boolean
}

interface RenderInputs {
  readonly visibleBlocks: readonly RenderableBlock[]
  readonly selectedBlockKey: string | null
  readonly highlightedBlockKeys: ReadonlySet<string>
  readonly renderMode: RenderMode
  readonly blockAssets: Readonly<Record<string, ResolvedBlockAsset>>
}

interface MeshGroup {
  readonly signature: string
  readonly size: readonly [x: number, y: number, z: number]
  readonly offset: readonly [x: number, y: number, z: number]
  readonly material: MeshLambertMaterial | MeshLambertMaterial[]
  readonly instances: RenderableBlock[]
}

const DEFAULT_DIMENSIONS: StructureDimensions = { x: 16, y: 8, z: 16 }
const BASE_BLOCK_COLOR = new Color('#67c1ff')
const SELECTED_BLOCK_TINT = '#ffd166'
const SELECTED_BLOCK_COLOR = new Color('#ffd166')
const WHITE = new Color('#ffffff')
const textureLoader = new TextureLoader()
const textureCache = new Map<string, Texture>()
const FULL_BLOCK_ELEMENT: BlockModelElement = {
  from: [0, 0, 0],
  to: [16, 16, 16],
  faces: {
    up: '',
    down: '',
    north: '',
    south: '',
    east: '',
    west: ''
  }
}

export function StructureViewport({
  structure,
  visibleBlocks,
  selectedBlockKey,
  highlightedBlockKeys,
  renderMode,
  blockAssets,
  viewportCommand,
  onSelectBlock
}: StructureViewportProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<ViewportState | null>(null)
  const frameRef = useRef(0)
  const lastCommandIdRef = useRef<number | null>(null)
  const onSelectBlockRef = useRef(onSelectBlock)
  const renderInputsRef = useRef<RenderInputs>({
    visibleBlocks,
    selectedBlockKey,
    highlightedBlockKeys: new Set(highlightedBlockKeys),
    renderMode,
    blockAssets
  })

  useEffect(() => {
    onSelectBlockRef.current = onSelectBlock
  }, [onSelectBlock])

  useEffect(() => {
    renderInputsRef.current = { visibleBlocks, selectedBlockKey, highlightedBlockKeys: new Set(highlightedBlockKeys), renderMode, blockAssets }
  }, [blockAssets, highlightedBlockKeys, renderMode, selectedBlockKey, visibleBlocks])

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return undefined
    }
    const viewportContainer = container

    const scene = new Scene()
    scene.background = new Color('#15191d')

    const camera = new PerspectiveCamera(55, 1, 0.1, 5000)
    const renderer = new WebGLRenderer({ antialias: true })
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.08
    controls.screenSpacePanning = true
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    viewportContainer.appendChild(renderer.domElement)

    const ambient = new AmbientLight('#ffffff', 0.62)
    const key = new DirectionalLight('#ffffff', 1.45)
    key.position.set(24, 48, 32)
    const grid = new GridHelper(64, 64, '#4f5b66', '#252c33')
    scene.add(ambient, key, grid)

    viewportRef.current = {
      scene,
      camera,
      renderer,
      controls,
      blockMeshes: [],
      structureDimensions: DEFAULT_DIMENSIONS,
      renderPaused: false
    }

    frameCamera(viewportRef.current, DEFAULT_DIMENSIONS)

    const resizeObserver = new ResizeObserver(() => resizeViewport(viewportContainer, camera, renderer))

    function render(): void {
      frameRef.current = window.requestAnimationFrame(render)
      const viewport = viewportRef.current
      if (!viewport || viewport.renderPaused) {
        return
      }

      viewport.controls.update()
      viewport.renderer.render(viewport.scene, viewport.camera)
    }

    function handlePointerDown(event: PointerEvent): void {
      const viewport = viewportRef.current
      if (!viewport || viewport.blockMeshes.length === 0) {
        return
      }

      const rect = renderer.domElement.getBoundingClientRect()
      const pointer = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      const raycaster = new Raycaster()
      raycaster.setFromCamera(pointer, viewport.camera)
      const hit = raycaster.intersectObjects(
        viewport.blockMeshes.map((record) => record.mesh),
        false
      )[0]

      if (hit?.instanceId !== undefined) {
        const record = viewport.blockMeshes.find((candidate) => candidate.mesh === hit.object)
        onSelectBlockRef.current(record?.instanceBlocks[hit.instanceId] ?? null)
        return
      }

      onSelectBlockRef.current(null)
    }

    function handleContextLost(event: Event): void {
      event.preventDefault()
      const viewport = viewportRef.current
      if (viewport) {
        viewport.renderPaused = true
      }
    }

    function handleContextRestored(): void {
      const viewport = viewportRef.current
      if (viewport) {
        viewport.renderPaused = false
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
        resizeViewport(viewportContainer, camera, renderer)
        updateBlocks(viewport, renderInputsRef.current)
        frameCamera(viewport, viewport.structureDimensions)
      }
    }

    resizeObserver.observe(viewportContainer)
    resizeViewport(viewportContainer, camera, renderer)
    renderer.domElement.addEventListener('pointerdown', handlePointerDown)
    renderer.domElement.addEventListener('webglcontextlost', handleContextLost)
    renderer.domElement.addEventListener('webglcontextrestored', handleContextRestored)
    render()

    return () => {
      window.cancelAnimationFrame(frameRef.current)
      resizeObserver.disconnect()
      renderer.domElement.removeEventListener('pointerdown', handlePointerDown)
      renderer.domElement.removeEventListener('webglcontextlost', handleContextLost)
      renderer.domElement.removeEventListener('webglcontextrestored', handleContextRestored)
      removeBlocks(viewportRef.current)
      controls.dispose()
      renderer.dispose()
      renderer.domElement.remove()
      viewportRef.current = null
    }
  }, [])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) {
      return
    }

    viewport.structureDimensions = structure?.dimensions ?? DEFAULT_DIMENSIONS
    updateBlocks(viewport, { visibleBlocks, selectedBlockKey, highlightedBlockKeys: new Set(highlightedBlockKeys), renderMode, blockAssets })
  }, [blockAssets, highlightedBlockKeys, renderMode, selectedBlockKey, structure, visibleBlocks])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !structure) {
      return
    }

    frameCamera(viewport, structure.dimensions)
  }, [structure])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport || !viewportCommand || lastCommandIdRef.current === viewportCommand.id) {
      return
    }

    lastCommandIdRef.current = viewportCommand.id
    frameCamera(viewport, structure?.dimensions ?? DEFAULT_DIMENSIONS)
  }, [structure, viewportCommand])

  return (
    <div className="viewport-frame" ref={containerRef}>
      {!structure && <div className="viewport-placeholder">No structure loaded</div>}
      {structure && structure.blocks.length === 0 && <div className="viewport-placeholder">No non-air blocks</div>}
      {structure && structure.blocks.length > 0 && visibleBlocks.length === 0 && (
        <div className="viewport-placeholder">No blocks visible in current clipping range</div>
      )}
    </div>
  )
}

function resizeViewport(container: HTMLDivElement, camera: PerspectiveCamera, renderer: WebGLRenderer): void {
  const width = Math.max(container.clientWidth, 1)
  const height = Math.max(container.clientHeight, 1)
  renderer.setSize(width, height, false)
  camera.aspect = width / height
  camera.updateProjectionMatrix()
}

function updateBlocks(viewport: ViewportState, inputs: RenderInputs): void {
  removeBlocks(viewport)

  if (inputs.visibleBlocks.length === 0) {
    viewport.blockMeshes = []
    return
  }

  const groups = groupBlocks(inputs)
  const matrix = new Matrix4()
  viewport.blockMeshes = groups.map((group) => {
    const geometry = new BoxGeometry(group.size[0], group.size[1], group.size[2])
    const mesh = new InstancedMesh(geometry, group.material, group.instances.length)

    group.instances.forEach((block, index) => {
      matrix.makeTranslation(block.position[0] + group.offset[0], block.position[1] + group.offset[1], block.position[2] + group.offset[2])
      mesh.setMatrixAt(index, matrix)
      mesh.setColorAt(index, getInstanceColor(block, inputs))
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true
    }

    viewport.scene.add(mesh)
    return { mesh, instanceBlocks: group.instances }
  })
}

function groupBlocks(inputs: RenderInputs): readonly MeshGroup[] {
  const groups = new Map<string, MeshGroup>()

  for (const block of inputs.visibleBlocks) {
    for (const materialInfo of createMaterialInfos(block, inputs)) {
      const current = groups.get(materialInfo.signature)
      if (current) {
        current.instances.push(block)
        continue
      }

      groups.set(materialInfo.signature, {
        signature: materialInfo.signature,
        size: materialInfo.size,
        offset: materialInfo.offset,
        material: materialInfo.material,
        instances: [block]
      })
    }
  }

  return [...groups.values()]
}

function createMaterialInfos(
  block: RenderableBlock,
  inputs: RenderInputs
): ReadonlyArray<{
  readonly signature: string
  readonly size: readonly [x: number, y: number, z: number]
  readonly offset: readonly [x: number, y: number, z: number]
  readonly material: MeshLambertMaterial | MeshLambertMaterial[]
}> {
  if (inputs.renderMode === 'textured') {
    const asset = inputs.blockAssets[createBlockAssetKey(block.name, block.properties)]
    if (asset?.faces) {
      const isSelected = inputs.highlightedBlockKeys.has(getBlockKey(block.position))
      const tint = isSelected ? SELECTED_BLOCK_TINT : '#ffffff'
      const elements = asset.elements.length > 0 ? asset.elements : [{ ...FULL_BLOCK_ELEMENT, faces: asset.faces }]
      return elements.map((element) => {
        const geometry = getElementGeometry(element)
        return {
          signature: `textured:${isSelected ? 'selected' : 'default'}:${geometry.signature}:${getFaceSignature(element.faces)}:${getUvSignature(element.uvs)}`,
          size: geometry.size,
          offset: geometry.offset,
          material: createTexturedMaterials(element.faces, tint, element.uvs)
        }
      })
    }

    const color = asset?.fallbackColor ?? getPaletteColor(block)
    return [{
      signature: `fallback:${color}`,
      size: [1, 1, 1],
      offset: [0.5, 0.5, 0.5],
      material: createColorMaterial(color)
    }]
  }

  if (inputs.renderMode === 'palette') {
    const color = getPaletteColor(block)
    return [{
      signature: `palette:${color}`,
      size: [1, 1, 1],
      offset: [0.5, 0.5, 0.5],
      material: createColorMaterial(color)
    }]
  }

  return [{
    signature: 'debug',
    size: [1, 1, 1],
    offset: [0.5, 0.5, 0.5],
    material: createColorMaterial('#ffffff')
  }]
}

function createTexturedMaterials(
  faces: BlockFaceTextures,
  color: string,
  uvs: Readonly<Partial<Record<keyof BlockFaceTextures, ModelUv>>> = {}
): MeshLambertMaterial[] {
  return [
    createTexturedMaterial(faces.east, color, uvs.east),
    createTexturedMaterial(faces.west, color, uvs.west),
    createTexturedMaterial(faces.up, color, uvs.up),
    createTexturedMaterial(faces.down, color, uvs.down),
    createTexturedMaterial(faces.south, color, uvs.south),
    createTexturedMaterial(faces.north, color, uvs.north)
  ]
}

function createTexturedMaterial(dataUrl: string, color: string, uv?: ModelUv): MeshLambertMaterial {
  return new MeshLambertMaterial({
    color,
    map: loadTexture(dataUrl, uv)
  })
}

function getFaceSignature(faces: BlockFaceTextures): string {
  return [faces.east, faces.west, faces.up, faces.down, faces.south, faces.north].join('|')
}

function getUvSignature(uvs: BlockModelElement['uvs']): string {
  if (!uvs) {
    return ''
  }

  return [uvs.east, uvs.west, uvs.up, uvs.down, uvs.south, uvs.north]
    .map((uv) => uv?.join(',') ?? '')
    .join('|')
}

function getElementGeometry(element: BlockModelElement): {
  readonly signature: string
  readonly size: readonly [x: number, y: number, z: number]
  readonly offset: readonly [x: number, y: number, z: number]
} {
  const size: readonly [number, number, number] = [
    Math.max((element.to[0] - element.from[0]) / 16, 0.01),
    Math.max((element.to[1] - element.from[1]) / 16, 0.01),
    Math.max((element.to[2] - element.from[2]) / 16, 0.01)
  ]
  const offset: readonly [number, number, number] = [
    (element.from[0] + element.to[0]) / 32,
    (element.from[1] + element.to[1]) / 32,
    (element.from[2] + element.to[2]) / 32
  ]

  return {
    signature: `${element.from.join(',')}:${element.to.join(',')}`,
    size,
    offset
  }
}

function createColorMaterial(color: string): MeshLambertMaterial {
  return new MeshLambertMaterial({
    color,
    vertexColors: true
  })
}

function loadTexture(dataUrl: string, uv?: ModelUv): Texture {
  const cacheKey = uv ? `${dataUrl}#${uv.join(',')}` : dataUrl
  const cached = textureCache.get(cacheKey)
  if (cached) {
    return cached
  }

  const baseTexture = textureCache.get(dataUrl) ?? textureLoader.load(dataUrl)
  baseTexture.magFilter = NearestFilter
  baseTexture.minFilter = NearestFilter
  baseTexture.generateMipmaps = false
  baseTexture.colorSpace = SRGBColorSpace
  textureCache.set(dataUrl, baseTexture)

  const texture = uv ? baseTexture.clone() : baseTexture
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  texture.generateMipmaps = false
  texture.colorSpace = SRGBColorSpace
  if (uv) {
    texture.repeat.set(Math.max((uv[2] - uv[0]) / 16, 0.001), Math.max((uv[3] - uv[1]) / 16, 0.001))
    texture.offset.set(uv[0] / 16, 1 - uv[3] / 16)
    texture.needsUpdate = true
  }
  textureCache.set(cacheKey, texture)
  return texture
}

function getInstanceColor(block: RenderableBlock, inputs: RenderInputs): Color {
  if (inputs.highlightedBlockKeys.has(getBlockKey(block.position))) {
    return SELECTED_BLOCK_COLOR
  }

  if (inputs.renderMode === 'debug') {
    return BASE_BLOCK_COLOR
  }

  return WHITE
}

function getPaletteColor(block: RenderableBlock): string {
  let hash = block.state * 97
  for (const char of block.name) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }

  return `hsl(${hash % 360}, 52%, 58%)`
}

function removeBlocks(viewport: ViewportState | null): void {
  if (!viewport || viewport.blockMeshes.length === 0) {
    return
  }

  for (const record of viewport.blockMeshes) {
    viewport.scene.remove(record.mesh)
    record.mesh.geometry.dispose()
    const materials = Array.isArray(record.mesh.material) ? record.mesh.material : [record.mesh.material]
    for (const material of materials) {
      material.dispose()
    }
  }

  viewport.blockMeshes = []
}

function frameCamera(viewport: ViewportState, dimensions: StructureDimensions): void {
  const center = new Vector3(dimensions.x / 2, dimensions.y / 2, dimensions.z / 2)
  const maxDimension = Math.max(dimensions.x, dimensions.y, dimensions.z, 8)
  viewport.camera.position.set(
    center.x + maxDimension * 1.35,
    center.y + maxDimension * 1.15,
    center.z + maxDimension * 1.35
  )
  viewport.camera.near = 0.1
  viewport.camera.far = Math.max(5000, maxDimension * 20)
  viewport.camera.lookAt(center)
  viewport.camera.updateProjectionMatrix()
  viewport.controls.target.copy(center)
  viewport.controls.update()
}
