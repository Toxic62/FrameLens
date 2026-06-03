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
        { pos: [1, 0, 0], state: 1 }
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
      entityCount: 1
    })
    expect(structure.dimensions).toEqual({ x: 2, y: 1, z: 1 })
    expect(structure.blocks).toEqual([{ position: [1, 0, 0], state: 1, name: 'minecraft:stone', properties: {} }])
    expect(structure.entities).toEqual([{ id: 'minecraft:item' }])
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
