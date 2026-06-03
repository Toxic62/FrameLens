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
  Texture,
  TextureLoader,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { createBlockAssetKey } from '@shared/assets'
import type { RenderMode, ResolvedBlockAsset } from '@shared/assets'
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
  readonly renderMode: RenderMode
  readonly blockAssets: Readonly<Record<string, ResolvedBlockAsset>>
  readonly viewportCommand: ViewportCommand | null
  readonly onSelectBlock: (block: RenderableBlock | null) => void
}

interface BlockMeshRecord {
  readonly mesh: InstancedMesh
  readonly blocks: readonly RenderableBlock[]
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
  readonly renderMode: RenderMode
  readonly blockAssets: Readonly<Record<string, ResolvedBlockAsset>>
}

interface MeshGroup {
  readonly signature: string
  readonly material: MeshLambertMaterial | MeshLambertMaterial[]
  readonly blocks: RenderableBlock[]
}

const DEFAULT_DIMENSIONS: StructureDimensions = { x: 16, y: 8, z: 16 }
const BASE_BLOCK_COLOR = new Color('#67c1ff')
const SELECTED_BLOCK_COLOR = new Color('#ffd166')
const WHITE = new Color('#ffffff')
const textureLoader = new TextureLoader()
const textureCache = new Map<string, Texture>()

export function StructureViewport({
  structure,
  visibleBlocks,
  selectedBlockKey,
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
  const renderInputsRef = useRef<RenderInputs>({ visibleBlocks, selectedBlockKey, renderMode, blockAssets })

  useEffect(() => {
    onSelectBlockRef.current = onSelectBlock
  }, [onSelectBlock])

  useEffect(() => {
    renderInputsRef.current = { visibleBlocks, selectedBlockKey, renderMode, blockAssets }
  }, [blockAssets, renderMode, selectedBlockKey, visibleBlocks])

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
        onSelectBlockRef.current(record?.blocks[hit.instanceId] ?? null)
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
    updateBlocks(viewport, { visibleBlocks, selectedBlockKey, renderMode, blockAssets })
  }, [blockAssets, renderMode, selectedBlockKey, structure, visibleBlocks])

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
    const geometry = new BoxGeometry(1, 1, 1)
    const mesh = new InstancedMesh(geometry, group.material, group.blocks.length)

    group.blocks.forEach((block, index) => {
      matrix.makeTranslation(block.position[0] + 0.5, block.position[1] + 0.5, block.position[2] + 0.5)
      mesh.setMatrixAt(index, matrix)
      mesh.setColorAt(index, getInstanceColor(block, inputs))
    })

    mesh.instanceMatrix.needsUpdate = true
    if (mesh.instanceColor) {
      mesh.instanceColor.needsUpdate = true
    }

    viewport.scene.add(mesh)
    return { mesh, blocks: group.blocks }
  })
}

function groupBlocks(inputs: RenderInputs): readonly MeshGroup[] {
  const groups = new Map<string, MeshGroup>()

  for (const block of inputs.visibleBlocks) {
    const materialInfo = createMaterialInfo(block, inputs)
    const current = groups.get(materialInfo.signature)
    if (current) {
      current.blocks.push(block)
      continue
    }

    groups.set(materialInfo.signature, {
      signature: materialInfo.signature,
      material: materialInfo.material,
      blocks: [block]
    })
  }

  return [...groups.values()]
}

function createMaterialInfo(
  block: RenderableBlock,
  inputs: RenderInputs
): { readonly signature: string; readonly material: MeshLambertMaterial | MeshLambertMaterial[] } {
  if (inputs.renderMode === 'textured') {
    const asset = inputs.blockAssets[createBlockAssetKey(block.name, block.properties)]
    if (asset?.faces) {
      const signature = [
        asset.faces.east,
        asset.faces.west,
        asset.faces.up,
        asset.faces.down,
        asset.faces.south,
        asset.faces.north
      ].join('|')

      return {
        signature: `textured:${signature}`,
        material: [
          createTexturedMaterial(asset.faces.east),
          createTexturedMaterial(asset.faces.west),
          createTexturedMaterial(asset.faces.up),
          createTexturedMaterial(asset.faces.down),
          createTexturedMaterial(asset.faces.south),
          createTexturedMaterial(asset.faces.north)
        ]
      }
    }

    const color = asset?.fallbackColor ?? getPaletteColor(block)
    return {
      signature: `fallback:${color}`,
      material: createColorMaterial(color)
    }
  }

  if (inputs.renderMode === 'palette') {
    const color = getPaletteColor(block)
    return {
      signature: `palette:${color}`,
      material: createColorMaterial(color)
    }
  }

  return {
    signature: 'debug',
    material: createColorMaterial('#ffffff')
  }
}

function createTexturedMaterial(dataUrl: string): MeshLambertMaterial {
  return new MeshLambertMaterial({
    map: loadTexture(dataUrl),
    vertexColors: true
  })
}

function createColorMaterial(color: string): MeshLambertMaterial {
  return new MeshLambertMaterial({
    color,
    vertexColors: true
  })
}

function loadTexture(dataUrl: string): Texture {
  const cached = textureCache.get(dataUrl)
  if (cached) {
    return cached
  }

  const texture = textureLoader.load(dataUrl)
  texture.magFilter = NearestFilter
  texture.minFilter = NearestFilter
  textureCache.set(dataUrl, texture)
  return texture
}

function getInstanceColor(block: RenderableBlock, inputs: RenderInputs): Color {
  if (getBlockKey(block.position) === inputs.selectedBlockKey) {
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
