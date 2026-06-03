import type { BlockPosition, RenderableBlock, StructureDimensions } from './structure'

export type ClipAxis = 'x' | 'y' | 'z'

export interface ClipBounds {
  readonly xMin: number
  readonly xMax: number
  readonly yMin: number
  readonly yMax: number
  readonly zMin: number
  readonly zMax: number
}

export function createDefaultClipBounds(dimensions: StructureDimensions): ClipBounds {
  return {
    xMin: 0,
    xMax: Math.max(dimensions.x - 1, 0),
    yMin: 0,
    yMax: Math.max(dimensions.y - 1, 0),
    zMin: 0,
    zMax: Math.max(dimensions.z - 1, 0)
  }
}

export function isBlockVisible(block: RenderableBlock, clipBounds: ClipBounds): boolean {
  const [x, y, z] = block.position

  return (
    x >= clipBounds.xMin &&
    x <= clipBounds.xMax &&
    y >= clipBounds.yMin &&
    y <= clipBounds.yMax &&
    z >= clipBounds.zMin &&
    z <= clipBounds.zMax
  )
}

export function getVisibleBlocks(
  blocks: readonly RenderableBlock[],
  clipBounds: ClipBounds
): readonly RenderableBlock[] {
  return blocks.filter((block) => isBlockVisible(block, clipBounds))
}

export function getBlockKey(position: BlockPosition): string {
  return position.join(',')
}
