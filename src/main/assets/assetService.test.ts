import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import JSZip from 'jszip'
import { beforeEach, describe, expect, it } from 'vitest'
import {
  activateAssetRootPath,
  applyLearnedBlockCapabilities,
  detectBlockCapability,
  learnBlockCapabilitiesFromStructure,
  listBlockAssetIds,
  listDetectedBlockCapabilities,
  listItemAssetIds,
  resolveBlockAssets,
  setDownloadClientForTests,
  setLearnedCapabilityStorePath,
  setVanillaCacheRoot
} from './assetService'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
)

describe('assetService', () => {
  beforeEach(async () => {
    setVanillaCacheRoot(await mkdtemp(join(tmpdir(), 'framelens-vanilla-cache-')))
    setLearnedCapabilityStorePath(join(await mkdtemp(join(tmpdir(), 'framelens-learned-capabilities-')), 'capabilities.json'))
    setDownloadClientForTests({
      async getJson(url) {
        if (url.endsWith('version_manifest_v2.json')) {
          return { versions: [{ id: '1.20.1', url: 'https://example.test/1.20.1.json' }] }
        }

        return { downloads: { client: { url: 'https://example.test/1.20.1-client.jar' } } }
      },
      async getBuffer() {
        return createVanillaClientJar()
      }
    })
  })

  it('resolves loose full-cube block textures without executing code', async () => {
    const root = await mkdtemp(join(tmpdir(), 'framelens-assets-'))
    await mkdir(join(root, 'kubejs', 'assets', 'minecraft', 'blockstates'), { recursive: true })
    await mkdir(join(root, 'kubejs', 'assets', 'minecraft', 'models', 'block'), { recursive: true })
    await mkdir(join(root, 'kubejs', 'assets', 'minecraft', 'textures', 'block'), { recursive: true })
    await writeFile(join(root, 'minecraftinstance.json'), JSON.stringify({ minecraftVersion: '1.20.1' }))
    await writeFile(
      join(root, 'kubejs', 'assets', 'minecraft', 'blockstates', 'stone.json'),
      JSON.stringify({ variants: { '': { model: 'minecraft:block/stone' } } })
    )
    await writeFile(
      join(root, 'kubejs', 'assets', 'minecraft', 'models', 'block', 'stone.json'),
      JSON.stringify({ parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/stone' } })
    )
    await writeFile(join(root, 'kubejs', 'assets', 'minecraft', 'textures', 'block', 'stone.png'), PNG_1X1)

    const activation = await activateAssetRootPath(root)
    expect(activation.ok).toBe(true)

    const result = await resolveBlockAssets([{ blockName: 'minecraft:stone', properties: {} }])
    expect(result.activeSource?.rootPath).toBe(root)
    expect(result.assets['minecraft:stone']).toMatchObject({
      assetKey: 'minecraft:stone',
      blockName: 'minecraft:stone',
      status: 'textured-cube'
    })
    expect(result.assets['minecraft:stone']?.faces?.north).toMatch(/^data:image\/png;base64,/)
  })

  it('downloads and caches vanilla assets for a selected instance version', async () => {
    const root = await mkdtemp(join(tmpdir(), 'framelens-vanilla-instance-'))
    await writeFile(join(root, 'minecraftinstance.json'), JSON.stringify({ minecraftVersion: '1.20.1' }))

    const activation = await activateAssetRootPath(root)
    expect(activation).toMatchObject({
      ok: true,
      source: {
        rootPath: root,
        minecraftVersion: '1.20.1',
        hasVanillaJar: true,
        vanillaStatus: 'downloaded'
      }
    })

    const result = await resolveBlockAssets([{ blockName: 'minecraft:stone', properties: {} }])
    expect(result.assets['minecraft:stone']).toMatchObject({
      assetKey: 'minecraft:stone',
      status: 'textured-cube'
    })
    expect(result.assets['minecraft:stone']?.faces?.north).toMatch(/^data:image\/png;base64,/)
  })

  it('lists block IDs from detected vanilla and loose blockstates', async () => {
    const root = await mkdtemp(join(tmpdir(), 'framelens-block-id-instance-'))
    await mkdir(join(root, 'kubejs', 'assets', 'custom', 'blockstates', 'machines'), { recursive: true })
    await writeFile(join(root, 'minecraftinstance.json'), JSON.stringify({ minecraftVersion: '1.20.1' }))
    await writeFile(
      join(root, 'kubejs', 'assets', 'custom', 'blockstates', 'machines', 'cutter.json'),
      JSON.stringify({ variants: { '': { model: 'custom:block/machines/cutter' } } })
    )

    await activateAssetRootPath(root)
    const blockIds = await listBlockAssetIds()

    expect(blockIds).toContain('custom:machines/cutter')
    expect(blockIds).toContain('minecraft:stone')
  })

  it('lists item IDs from detected item models', async () => {
    const root = await mkdtemp(join(tmpdir(), 'framelens-item-id-instance-'))
    await mkdir(join(root, 'kubejs', 'assets', 'custom', 'models', 'item', 'tools'), { recursive: true })
    await writeFile(
      join(root, 'kubejs', 'assets', 'custom', 'models', 'item', 'tools', 'hammer.json'),
      JSON.stringify({ parent: 'item/generated', textures: { layer0: 'custom:item/tools/hammer' } })
    )

    await activateAssetRootPath(root)
    const itemIds = await listItemAssetIds()

    expect(itemIds).toContain('custom:tools/hammer')
  })

  it('detects container capabilities from mod jar block entity class names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'framelens-modded-capabilities-'))
    await mkdir(join(root, 'mods'), { recursive: true })
    const zip = new JSZip()
    zip.file('assets/reinfchest/blockstates/iron.json', JSON.stringify({ variants: { '': { model: 'reinfchest:block/iron' } } }))
    zip.file('com/example/reinfchest/block/entity/IronChestBlockEntity.class', Buffer.from([0xca, 0xfe, 0xba, 0xbe]))
    await writeFile(join(root, 'mods', 'reinfchest.jar'), Buffer.from(await zip.generateAsync({ type: 'uint8array' })))

    await activateAssetRootPath(root)
    const capabilities = await listDetectedBlockCapabilities()

    expect(capabilities['reinfchest:iron']).toEqual({ kind: 'container', supportsLootTable: true })
    await expect(detectBlockCapability('reinfchest:iron')).resolves.toEqual({ kind: 'container', supportsLootTable: true })
  })

  it('detects generic block entity data capabilities from mod jar class names', async () => {
    const root = await mkdtemp(join(tmpdir(), 'framelens-generic-capabilities-'))
    await mkdir(join(root, 'mods'), { recursive: true })
    const zip = new JSZip()
    zip.file('assets/techmod/blockstates/solar_panel.json', JSON.stringify({ variants: { '': { model: 'techmod:block/solar_panel' } } }))
    zip.file('com/example/techmod/block/entity/SolarPanelBlockEntity.class', Buffer.from([0xca, 0xfe, 0xba, 0xbe]))
    await writeFile(join(root, 'mods', 'techmod.jar'), Buffer.from(await zip.generateAsync({ type: 'uint8array' })))

    await activateAssetRootPath(root)
    const capabilities = await listDetectedBlockCapabilities()

    expect(capabilities['techmod:solar_panel']).toEqual({ kind: 'generic', supportsLootTable: false })
  })

  it('persists learned block capabilities from structure NBT across cache reloads', async () => {
    const storePath = join(await mkdtemp(join(tmpdir(), 'framelens-persisted-capabilities-')), 'capabilities.json')
    setLearnedCapabilityStorePath(storePath)
    const structure = {
      metadata: { fileName: 'learned.nbt', byteSize: 128, paletteCount: 1, blockCount: 1, blockEntityCount: 1, entityCount: 0 },
      dimensions: { x: 1, y: 1, z: 1 },
      palette: [{ index: 0, name: 'modded:ancient_machine', properties: {} }],
      blocks: [
        {
          position: [0, 0, 0] as const,
          state: 0,
          name: 'modded:ancient_machine',
          properties: {},
          blockEntity: {
            id: 'modded:ancient_machine',
            kind: 'container' as const,
            position: [0, 0, 0] as const,
            containerMode: 'items' as const,
            items: [{ slot: 0, id: 'minecraft:diamond', count: 1 }],
            fields: {}
          }
        }
      ],
      entities: []
    }

    await learnBlockCapabilitiesFromStructure(structure)
    setLearnedCapabilityStorePath(storePath)

    await expect(detectBlockCapability('modded:ancient_machine')).resolves.toEqual({ kind: 'container', supportsLootTable: false })
    await expect(listDetectedBlockCapabilities()).resolves.toMatchObject({
      'modded:ancient_machine': { kind: 'container', supportsLootTable: false }
    })

    const applied = await applyLearnedBlockCapabilities({
      ...structure,
      blocks: [
        {
          ...structure.blocks[0]!,
          blockEntity: {
            id: 'modded:ancient_machine',
            kind: 'generic' as const,
            position: [0, 0, 0] as const,
            fields: {}
          }
        }
      ]
    })

    expect(applied.blocks[0]?.blockEntity).toMatchObject({
      kind: 'container',
      containerMode: 'items',
      items: []
    })
  })

  it('uses entity chest textures instead of plank fallback for chests', async () => {
    const root = await mkdtemp(join(tmpdir(), 'framelens-chest-instance-'))
    await writeFile(join(root, 'minecraftinstance.json'), JSON.stringify({ minecraftVersion: '1.20.1' }))

    await activateAssetRootPath(root)
    const result = await resolveBlockAssets([{ blockName: 'minecraft:chest', properties: { facing: 'north' } }])
    const asset = result.assets['minecraft:chest[facing=north]']

    expect(asset).toMatchObject({
      assetKey: 'minecraft:chest[facing=north]',
      status: 'textured-cube',
      elements: [
        {
          from: [1, 0, 1],
          to: [15, 14, 15],
          uvSize: [64, 64],
          uvs: expect.objectContaining({ north: [14, 33, 28, 47] })
        }
      ]
    })
    expect(asset?.faces?.north).toBe(`data:image/png;base64,${Buffer.concat([PNG_1X1, Buffer.from('chest')]).toString('base64')}`)
  })

  it('selects simple blockstate variants using palette properties', async () => {
    const root = await mkdtemp(join(tmpdir(), 'framelens-variant-assets-'))
    await mkdir(join(root, 'kubejs', 'assets', 'minecraft', 'blockstates'), { recursive: true })
    await mkdir(join(root, 'kubejs', 'assets', 'minecraft', 'models', 'block'), { recursive: true })
    await mkdir(join(root, 'kubejs', 'assets', 'minecraft', 'textures', 'block'), { recursive: true })
    await writeFile(
      join(root, 'kubejs', 'assets', 'minecraft', 'blockstates', 'oak_log.json'),
      JSON.stringify({
        variants: {
          'axis=x': { model: 'minecraft:block/oak_log_horizontal' },
          'axis=y': { model: 'minecraft:block/oak_log' }
        }
      })
    )
    await writeFile(
      join(root, 'kubejs', 'assets', 'minecraft', 'models', 'block', 'oak_log_horizontal.json'),
      JSON.stringify({ parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/oak_log_horizontal' } })
    )
    await writeFile(
      join(root, 'kubejs', 'assets', 'minecraft', 'models', 'block', 'oak_log.json'),
      JSON.stringify({ parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/oak_log' } })
    )
    await writeFile(join(root, 'kubejs', 'assets', 'minecraft', 'textures', 'block', 'oak_log_horizontal.png'), PNG_1X1)
    await writeFile(
      join(root, 'kubejs', 'assets', 'minecraft', 'textures', 'block', 'oak_log.png'),
      Buffer.concat([PNG_1X1, Buffer.from('vertical')])
    )

    await activateAssetRootPath(root)
    const result = await resolveBlockAssets([{ blockName: 'minecraft:oak_log', properties: { axis: 'x' } }])
    const asset = result.assets['minecraft:oak_log[axis=x]']

    expect(asset).toMatchObject({
      assetKey: 'minecraft:oak_log[axis=x]',
      status: 'textured-cube'
    })
    expect(asset?.faces?.north).toBe(`data:image/png;base64,${PNG_1X1.toString('base64')}`)
  })

  it('resolves face texture references from model elements', async () => {
    const root = await mkdtemp(join(tmpdir(), 'framelens-element-face-assets-'))
    await mkdir(join(root, 'kubejs', 'assets', 'custom', 'blockstates'), { recursive: true })
    await mkdir(join(root, 'kubejs', 'assets', 'custom', 'models', 'block'), { recursive: true })
    await mkdir(join(root, 'kubejs', 'assets', 'custom', 'textures', 'block'), { recursive: true })
    await writeFile(
      join(root, 'kubejs', 'assets', 'custom', 'blockstates', 'machine.json'),
      JSON.stringify({ variants: { '': { model: 'custom:block/machine' } } })
    )
    await writeFile(
      join(root, 'kubejs', 'assets', 'custom', 'models', 'block', 'machine.json'),
      JSON.stringify({
        textures: { '0': 'custom:block/machine_side' },
        elements: [
          {
            from: [0, 0, 0],
            to: [16, 16, 16],
            faces: {
              down: { texture: '#0' },
              up: { texture: '#0' },
              north: { texture: '#0', uv: [2, 4, 14, 16] },
              south: { texture: '#0' },
              west: { texture: '#0' },
              east: { texture: '#0' }
            }
          }
        ]
      })
    )
    await writeFile(join(root, 'kubejs', 'assets', 'custom', 'textures', 'block', 'machine_side.png'), PNG_1X1)

    await activateAssetRootPath(root)
    const result = await resolveBlockAssets([{ blockName: 'custom:machine', properties: {} }])

    expect(result.assets['custom:machine']).toMatchObject({
      assetKey: 'custom:machine',
      status: 'textured-cube'
    })
    expect(result.assets['custom:machine']?.faces?.north).toBe(`data:image/png;base64,${PNG_1X1.toString('base64')}`)
    expect(result.assets['custom:machine']?.elements).toEqual([
      {
        from: [0, 0, 0],
        to: [16, 16, 16],
        faces: {
          up: `data:image/png;base64,${PNG_1X1.toString('base64')}`,
          down: `data:image/png;base64,${PNG_1X1.toString('base64')}`,
          north: `data:image/png;base64,${PNG_1X1.toString('base64')}`,
          south: `data:image/png;base64,${PNG_1X1.toString('base64')}`,
          east: `data:image/png;base64,${PNG_1X1.toString('base64')}`,
          west: `data:image/png;base64,${PNG_1X1.toString('base64')}`
        },
        uvs: { north: [2, 4, 14, 16] }
      }
    ])
  })

  it('preserves slab-like model element bounds for non-full-cube rendering', async () => {
    const root = await mkdtemp(join(tmpdir(), 'framelens-slab-assets-'))
    await mkdir(join(root, 'kubejs', 'assets', 'custom', 'blockstates'), { recursive: true })
    await mkdir(join(root, 'kubejs', 'assets', 'custom', 'models', 'block'), { recursive: true })
    await mkdir(join(root, 'kubejs', 'assets', 'custom', 'textures', 'block'), { recursive: true })
    await writeFile(
      join(root, 'kubejs', 'assets', 'custom', 'blockstates', 'half_block.json'),
      JSON.stringify({ variants: { 'type=bottom': { model: 'custom:block/half_block' } } })
    )
    await writeFile(
      join(root, 'kubejs', 'assets', 'custom', 'models', 'block', 'half_block.json'),
      JSON.stringify({
        textures: { all: 'custom:block/half_block' },
        elements: [
          {
            from: [0, 0, 0],
            to: [16, 8, 16],
            faces: {
              down: { texture: '#all' },
              up: { texture: '#all' },
              north: { texture: '#all' },
              south: { texture: '#all' },
              west: { texture: '#all' },
              east: { texture: '#all' }
            }
          }
        ]
      })
    )
    await writeFile(join(root, 'kubejs', 'assets', 'custom', 'textures', 'block', 'half_block.png'), PNG_1X1)

    await activateAssetRootPath(root)
    const result = await resolveBlockAssets([{ blockName: 'custom:half_block', properties: { type: 'bottom' } }])

    expect(result.assets['custom:half_block[type=bottom]']).toMatchObject({
      status: 'textured-cube',
      elements: [{ from: [0, 0, 0], to: [16, 8, 16] }]
    })
  })

  it.runIf(process.env.FRAMELENS_RUN_ASTRALIS_TEST === 'true')(
    'resolves a read-only block asset from the Astralis instance when present',
    async () => {
      const root = '/Users/yuuto/Documents/astralis'
      const activation = await activateAssetRootPath(root)
      if (!activation.ok) {
        return
      }

      const result = await resolveBlockAssets([{ blockName: 'supplementaries:ash_bricks', properties: {} }])
      expect(result.assets['supplementaries:ash_bricks']).toMatchObject({
        assetKey: 'supplementaries:ash_bricks',
        blockName: 'supplementaries:ash_bricks',
        status: 'textured-cube'
      })
      expect(result.assets['supplementaries:ash_bricks']?.faces?.up).toMatch(/^data:image\/png;base64,/)
    },
    20000
  )
})

async function createVanillaClientJar(): Promise<Buffer> {
  const zip = new JSZip()
  zip.file('assets/minecraft/blockstates/stone.json', JSON.stringify({ variants: { '': { model: 'minecraft:block/stone' } } }))
  zip.file(
    'assets/minecraft/models/block/stone.json',
    JSON.stringify({ parent: 'minecraft:block/cube_all', textures: { all: 'minecraft:block/stone' } })
  )
  zip.file('assets/minecraft/textures/block/stone.png', PNG_1X1)
  zip.file('assets/minecraft/textures/entity/chest/normal.png', Buffer.concat([PNG_1X1, Buffer.from('chest')]))
  zip.file('assets/minecraft/textures/entity/chest/trapped.png', Buffer.concat([PNG_1X1, Buffer.from('trapped-chest')]))
  zip.file('assets/minecraft/textures/entity/chest/ender.png', Buffer.concat([PNG_1X1, Buffer.from('ender-chest')]))
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }))
}
