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
  Scene,
  Vector3,
  WebGLRenderer
} from 'three'
import type { LoadedStructure } from '@shared/structure'

interface StructureViewportProps {
  readonly structure: LoadedStructure | undefined
}

export function StructureViewport({ structure }: StructureViewportProps): ReactElement {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) {
      return undefined
    }

    const scene = new Scene()
    scene.background = new Color('#15191d')

    const camera = new PerspectiveCamera(55, 1, 0.1, 5000)
    const renderer = new WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    container.appendChild(renderer.domElement)

    const ambient = new AmbientLight('#ffffff', 0.6)
    const key = new DirectionalLight('#ffffff', 1.5)
    key.position.set(24, 48, 32)
    scene.add(ambient, key)

    const grid = new GridHelper(64, 64, '#4f5b66', '#252c33')
    scene.add(grid)

    let blocks: InstancedMesh | undefined
    if (structure && structure.blocks.length > 0) {
      const geometry = new BoxGeometry(1, 1, 1)
      const material = new MeshLambertMaterial({ color: '#67c1ff' })
      blocks = new InstancedMesh(geometry, material, structure.blocks.length)
      const matrix = new Matrix4()

      structure.blocks.forEach((block, index) => {
        matrix.makeTranslation(block.position[0] + 0.5, block.position[1] + 0.5, block.position[2] + 0.5)
        blocks?.setMatrixAt(index, matrix)
      })

      blocks.instanceMatrix.needsUpdate = true
      scene.add(blocks)
    }

    const dimensions = structure?.dimensions ?? { x: 16, y: 8, z: 16 }
    const center = new Vector3(dimensions.x / 2, dimensions.y / 2, dimensions.z / 2)
    const maxDimension = Math.max(dimensions.x, dimensions.y, dimensions.z, 8)
    camera.position.set(center.x + maxDimension * 1.35, center.y + maxDimension * 1.15, center.z + maxDimension * 1.35)
    camera.lookAt(center)

    let frameId = 0
    const resizeObserver = new ResizeObserver(() => {
      const width = Math.max(container.clientWidth, 1)
      const height = Math.max(container.clientHeight, 1)
      renderer.setSize(width, height, false)
      camera.aspect = width / height
      camera.updateProjectionMatrix()
    })

    function render(): void {
      frameId = window.requestAnimationFrame(render)
      scene.rotation.y += 0.002
      renderer.render(scene, camera)
    }

    resizeObserver.observe(container)
    render()

    return () => {
      window.cancelAnimationFrame(frameId)
      resizeObserver.disconnect()
      blocks?.geometry.dispose()
      if (blocks?.material instanceof MeshLambertMaterial) {
        blocks.material.dispose()
      }
      renderer.dispose()
      renderer.domElement.remove()
    }
  }, [structure])

  return (
    <div className="viewport-frame" ref={containerRef}>
      {!structure && <div className="viewport-placeholder">No structure loaded</div>}
      {structure && structure.blocks.length === 0 && <div className="viewport-placeholder">No non-air blocks</div>}
    </div>
  )
}
