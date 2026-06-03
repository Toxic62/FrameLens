import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { activateAssetRootPath, resolveBlockAssets } from './assetService'

const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64'
)

describe('assetService', () => {
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

  it.runIf(process.env.CI !== 'true')(
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
