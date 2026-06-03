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
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer
} from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
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
  readonly viewportCommand: ViewportCommand | null
  readonly onSelectBlock: (block: RenderableBlock | null) => void
}

interface ViewportState {
  readonly scene: Scene
  readonly camera: PerspectiveCamera
  readonly renderer: WebGLRenderer
  readonly controls: OrbitControls
  blocks: InstancedMesh | null
  visibleBlocksByInstance: readonly RenderableBlock[]
  structureDimensions: StructureDimensions
  renderPaused: boolean
}

const DEFAULT_DIMENSIONS: StructureDimensions = { x: 16, y: 8, z: 16 }
const BASE_BLOCK_COLOR = new Color('#67c1ff')
const SELECTED_BLOCK_COLOR = new Color('#ffd166')

export function StructureViewport({
  structure,
  visibleBlocks,
  selectedBlockKey,
  viewportCommand,
  onSelectBlock
}: StructureViewportProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<ViewportState | null>(null)
  const frameRef = useRef(0)
  const lastCommandIdRef = useRef<number | null>(null)
  const onSelectBlockRef = useRef(onSelectBlock)
  const visibleBlocksRef = useRef(visibleBlocks)
  const selectedBlockKeyRef = useRef(selectedBlockKey)

  useEffect(() => {
    onSelectBlockRef.current = onSelectBlock
  }, [onSelectBlock])

  useEffect(() => {
    visibleBlocksRef.current = visibleBlocks
    selectedBlockKeyRef.current = selectedBlockKey
  }, [selectedBlockKey, visibleBlocks])

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
      blocks: null,
      visibleBlocksByInstance: [],
      structureDimensions: DEFAULT_DIMENSIONS,
      renderPaused: false
    }

    frameCamera(viewportRef.current, DEFAULT_DIMENSIONS)

    const resizeObserver = new ResizeObserver(() => resizeViewport(container, camera, renderer))

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
      if (!viewport || !viewport.blocks || viewport.visibleBlocksByInstance.length === 0) {
        return
      }

      const rect = renderer.domElement.getBoundingClientRect()
      const pointer = new Vector2(
        ((event.clientX - rect.left) / rect.width) * 2 - 1,
        -((event.clientY - rect.top) / rect.height) * 2 + 1
      )
      const raycaster = new Raycaster()
      raycaster.setFromCamera(pointer, viewport.camera)
      const hit = raycaster.intersectObject(viewport.blocks, false)[0]

      if (hit?.instanceId !== undefined) {
        onSelectBlockRef.current(viewport.visibleBlocksByInstance[hit.instanceId] ?? null)
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
        updateBlocks(viewport, visibleBlocksRef.current, selectedBlockKeyRef.current)
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
    updateBlocks(viewport, visibleBlocks, selectedBlockKey)
  }, [selectedBlockKey, structure, visibleBlocks])

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

function updateBlocks(
  viewport: ViewportState,
  visibleBlocks: readonly RenderableBlock[],
  selectedBlockKey: string | null
): void {
  removeBlocks(viewport)

  if (visibleBlocks.length === 0) {
    viewport.visibleBlocksByInstance = []
    return
  }

  const geometry = new BoxGeometry(1, 1, 1)
  const material = new MeshLambertMaterial({ vertexColors: true })
  const blocks = new InstancedMesh(geometry, material, visibleBlocks.length)
  const matrix = new Matrix4()

  visibleBlocks.forEach((block, index) => {
    matrix.makeTranslation(block.position[0] + 0.5, block.position[1] + 0.5, block.position[2] + 0.5)
    blocks.setMatrixAt(index, matrix)
    blocks.setColorAt(index, getBlockKey(block.position) === selectedBlockKey ? SELECTED_BLOCK_COLOR : BASE_BLOCK_COLOR)
  })

  blocks.instanceMatrix.needsUpdate = true
  if (blocks.instanceColor) {
    blocks.instanceColor.needsUpdate = true
  }

  viewport.blocks = blocks
  viewport.visibleBlocksByInstance = visibleBlocks
  viewport.scene.add(blocks)
}

function removeBlocks(viewport: ViewportState | null): void {
  if (!viewport?.blocks) {
    return
  }

  viewport.scene.remove(viewport.blocks)
  viewport.blocks.geometry.dispose()
  if (viewport.blocks.material instanceof MeshLambertMaterial) {
    viewport.blocks.material.dispose()
  }
  viewport.blocks = null
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
