import { describe, expect, it } from 'vitest'
import nbt from 'prismarine-nbt'
import { parseMinecraftStructure, StructureParseError } from './minecraftStructureParser'

describe('parseMinecraftStructure', () => {
  it('normalizes metadata and filters air blocks from renderable blocks', async () => {
    const data = await writeStructureFixture({
      size: [2, 1, 1],
      palette: [{ Name: 'minecraft:air' }, { Name: 'minecraft:stone' }],
      blocks: [
        { pos: [0, 0, 0], state: 0 },
        { pos: [1, 0, 0], state: 1, nbt: { id: 'minecraft:chest', LootTable: 'minecraft:chests/simple_dungeon' } }
      ],
      entities: [{ nbt: { id: 'minecraft:item' } }]
    })

    const structure = await parseMinecraftStructure({
      fileName: 'fixture.nbt',
      byteSize: data.byteLength,
      data
    })

    expect(structure.metadata).toMatchObject({
      fileName: 'fixture.nbt',
      byteSize: data.byteLength,
      paletteCount: 2,
      blockCount: 2,
      blockEntityCount: 1,
      entityCount: 1
    })
    expect(structure.dimensions).toEqual({ x: 2, y: 1, z: 1 })
    expect(structure.blocks).toEqual([
      {
        position: [1, 0, 0],
        state: 1,
        name: 'minecraft:stone',
        properties: {},
        blockEntity: {
          id: 'minecraft:chest',
          kind: 'container',
          position: [1, 0, 0],
          containerMode: 'lootTable',
          items: [],
          fields: { LootTable: 'minecraft:chests/simple_dungeon' }
        }
      }
    ])
    expect(structure.entities).toEqual([{ id: 'minecraft:item' }])
  })

  it('preserves container item summaries for inventory-backed containers', async () => {
    const data = await writeStructureFixture({
      size: [1, 1, 1],
      palette: [{ Name: 'minecraft:barrel' }],
      blocks: [
        {
          pos: [0, 0, 0],
          state: 0,
          nbt: {
            id: 'minecraft:barrel',
            Items: [
              { Slot: 3, id: 'minecraft:diamond', Count: 12 },
              { Slot: 4, id: 'minecraft:apple', Count: 2 }
            ]
          }
        }
      ],
      entities: []
    })

    const structure = await parseMinecraftStructure({ fileName: 'barrel.nbt', byteSize: data.byteLength, data })

    expect(structure.blocks[0]?.blockEntity).toMatchObject({
      kind: 'container',
      containerMode: 'items',
      items: [
        { slot: 3, id: 'minecraft:diamond', count: 12 },
        { slot: 4, id: 'minecraft:apple', count: 2 }
      ]
    })
  })

  it('infers storage-like modded block entities as editable containers', async () => {
    const data = await writeStructureFixture({
      size: [1, 1, 1],
      palette: [{ Name: 'create:item_vault' }],
      blocks: [{ pos: [0, 0, 0], state: 0, nbt: { id: 'create:item_vault' } }],
      entities: []
    })

    const structure = await parseMinecraftStructure({ fileName: 'item-vault.nbt', byteSize: data.byteLength, data })

    expect(structure.blocks[0]?.blockEntity).toMatchObject({
      id: 'create:item_vault',
      kind: 'container',
      containerMode: 'items',
      items: []
    })
  })

  it('keeps editable jigsaw block entity fields', async () => {
    const data = await writeStructureFixture({
      size: [1, 1, 1],
      palette: [{ Name: 'minecraft:jigsaw', Properties: { orientation: 'north_up' } }],
      blocks: [
        {
          pos: [0, 0, 0],
          state: 0,
          nbt: {
            id: 'minecraft:jigsaw',
            name: 'minecraft:village/plains/houses',
            target: 'minecraft:street',
            pool: 'minecraft:village/plains/town_centers',
            final_state: 'minecraft:air',
            joint: 'rollable'
          }
        }
      ],
      entities: []
    })

    const structure = await parseMinecraftStructure({
      fileName: 'jigsaw.nbt',
      byteSize: data.byteLength,
      data
    })

    expect(structure.metadata.blockEntityCount).toBe(1)
    expect(structure.blocks[0]?.blockEntity).toMatchObject({
      id: 'minecraft:jigsaw',
      kind: 'jigsaw',
      fields: {
        name: 'minecraft:village/plains/houses',
        target: 'minecraft:street',
        pool: 'minecraft:village/plains/town_centers',
        final_state: 'minecraft:air',
        joint: 'rollable'
      }
    })
  })

  it('rejects missing required structure fields with a controlled error', async () => {
    const data = await writeStructureFixture({ size: [1, 1, 1], palette: [] })

    await expect(
      parseMinecraftStructure({
        fileName: 'broken.nbt',
        byteSize: data.byteLength,
        data
      })
    ).rejects.toBeInstanceOf(StructureParseError)
  })
})

function writeStructureFixture(value: unknown): Promise<Buffer> {
  return Promise.resolve(
    nbt.writeUncompressed({
      name: '',
      type: 'compound',
      value: toNbtCompound(value)
    })
  )
}

function toNbtValue(value: unknown): nbt.Tags[nbt.TagType] {
  if (Array.isArray(value)) {
    if (value.every((entry) => typeof entry === 'number')) {
      return {
        type: 'list',
        value: {
          type: 'int',
          value: value as number[]
        }
      } as unknown as nbt.Tags[nbt.TagType]
    }

    return {
      type: 'list',
      value: {
        type: 'compound',
        value: value.map((entry) => toNbtCompound(entry))
      }
    } as unknown as nbt.Tags[nbt.TagType]
  }

  if (typeof value === 'number') {
    return { type: 'int', value }
  }

  if (typeof value === 'string') {
    return { type: 'string', value }
  }

  return {
    type: 'compound',
    value: toNbtCompound(value)
  }
}

function toNbtCompound(value: unknown): Record<string, nbt.Tags[nbt.TagType]> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Fixture compound values must be objects.')
  }

  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, toNbtValue(entry)]))
}
