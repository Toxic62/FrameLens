import { describe, expect, it } from 'vitest'
import type { RenderableBlock } from './structure'
import { createDefaultClipBounds, getBlockKey, getVisibleBlocks, isBlockVisible } from './viewer'

const blocks: readonly RenderableBlock[] = [
  { position: [0, 0, 0], state: 0, name: 'minecraft:stone', properties: {} },
  { position: [1, 0, 0], state: 1, name: 'minecraft:dirt', properties: {} },
  { position: [2, 1, 2], state: 2, name: 'minecraft:glass', properties: {} }
]

describe('viewer clipping', () => {
  it('creates full-structure bounds by default', () => {
    expect(createDefaultClipBounds({ x: 3, y: 2, z: 4 })).toEqual({
      xMin: 0,
      xMax: 2,
      yMin: 0,
      yMax: 1,
      zMin: 0,
      zMax: 3
    })
  })

  it('filters visible blocks without mutating source blocks', () => {
    const visible = getVisibleBlocks(blocks, {
      xMin: 1,
      xMax: 2,
      yMin: 0,
      yMax: 1,
      zMin: 0,
      zMax: 1
    })

    expect(visible).toEqual([blocks[1]])
    expect(blocks).toHaveLength(3)
  })

  it('uses inclusive min and max clipping bounds', () => {
    expect(
      isBlockVisible(blocks[2]!, {
        xMin: 2,
        xMax: 2,
        yMin: 1,
        yMax: 1,
        zMin: 2,
        zMax: 2
      })
    ).toBe(true)
  })

  it('creates stable block keys from positions', () => {
    expect(getBlockKey([12, 3, 8])).toBe('12,3,8')
  })
})
