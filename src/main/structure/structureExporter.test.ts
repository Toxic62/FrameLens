import { describe, expect, it } from 'vitest'
import type { LoadedStructure } from '@shared/structure'
import { parseMinecraftStructure } from './minecraftStructureParser'
import { exportMinecraftStructure } from './structureExporter'

describe('exportMinecraftStructure', () => {
  it('writes a parseable structure with edited blocks and simple block entity fields', async () => {
    const structure: LoadedStructure = {
      metadata: {
        fileName: 'edited.nbt',
        byteSize: 0,
        paletteCount: 1,
        blockCount: 2,
        blockEntityCount: 1,
        entityCount: 0
      },
      dimensions: { x: 2, y: 1, z: 1 },
      palette: [{ index: 0, name: 'minecraft:stone', properties: {} }],
      blocks: [
        { position: [0, 0, 0], state: 0, name: 'minecraft:stone', properties: {} },
        {
          position: [1, 0, 0],
          state: 1,
          name: 'minecraft:chest',
          properties: { facing: 'north' },
          blockEntity: {
            id: 'minecraft:chest',
            kind: 'container',
            position: [1, 0, 0],
            fields: { LootTable: 'minecraft:chests/simple_dungeon', LootTableSeed: '12' }
          }
        }
      ],
      entities: []
    }

    const buffer = exportMinecraftStructure(structure)
    const parsed = await parseMinecraftStructure({ fileName: 'roundtrip.nbt', byteSize: buffer.byteLength, data: buffer })

    expect(parsed.dimensions).toEqual({ x: 2, y: 1, z: 1 })
    expect(parsed.blocks).toHaveLength(2)
    expect(parsed.blocks[1]).toMatchObject({
      name: 'minecraft:chest',
      properties: { facing: 'north' },
      blockEntity: {
        id: 'minecraft:chest',
        fields: { LootTable: 'minecraft:chests/simple_dungeon', LootTableSeed: '12' }
      }
    })
  })
})
