// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from './App'
import type { LoadedStructure, OpenStructureResult } from '@shared/structure'

const { viewportSpy } = vi.hoisted(() => ({
  viewportSpy: vi.fn()
}))

vi.mock('./components/StructureViewport', async () => ({
  StructureViewport: (props: unknown) => {
    viewportSpy(props)
    return <div data-testid="structure-viewport" />
  }
}))

describe('App', () => {
  beforeEach(() => {
    viewportSpy.mockClear()
  })

  afterEach(() => {
    cleanup()
  })

  it('renders the empty structure state', () => {
    window.frameLens = createApiMock({ currentStructure: null })

    render(<App />)

    expect(screen.getByRole('button', { name: 'Open .nbt' })).toBeInTheDocument()
    expect(screen.getByText(/Awaiting a Minecraft Java structure file/i)).toBeInTheDocument()
  })

  it('restores the current structure from the preload API', async () => {
    window.frameLens = createApiMock({ currentStructure: createStructure() })

    render(<App />)

    expect(await screen.findByText('restored.nbt')).toBeInTheDocument()
    expect(screen.getByText('1 x 1 x 1')).toBeInTheDocument()
    expect(screen.getByText('Visible')).toBeInTheDocument()
    expect(screen.getByText('stone')).toBeInTheDocument()
  })

  it('passes only visible blocks to the viewport when clipping changes', async () => {
    window.frameLens = createApiMock({
      currentStructure: {
        ...createStructure(),
        dimensions: { x: 2, y: 1, z: 1 },
        blocks: [
          { position: [0, 0, 0], state: 0, name: 'minecraft:stone', properties: {} },
          { position: [1, 0, 0], state: 0, name: 'minecraft:stone', properties: {} }
        ]
      }
    })

    render(<App />)

    expect(await screen.findByText('restored.nbt')).toBeInTheDocument()
    await waitFor(() => {
      const lastProps = viewportSpy.mock.calls.at(-1)?.[0] as { visibleBlocks: readonly unknown[] }
      expect(lastProps.visibleBlocks).toHaveLength(2)
    })
  })

  it('keeps viewport controls in the toolbar and shows bottom placement overlap state', async () => {
    window.frameLens = createApiMock({ currentStructure: createStructure() })

    render(<App />)

    expect(await screen.findByText('restored.nbt')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Viewport' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Debug' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Palette' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Textured' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fit' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'Reset' })[0]).toBeInTheDocument()
    await waitFor(() => {
      const lastProps = viewportSpy.mock.calls.at(-1)?.[0] as { renderMode: string }
      expect(lastProps.renderMode).toBe('textured')
    })

    fireEvent.click(screen.getByRole('button', { name: 'Add' }))

    expect(screen.getByRole('dialog', { name: 'Add block' })).toBeInTheDocument()
    expect(screen.getByText('Placement 0, 0, 0')).toBeInTheDocument()
    expect(screen.getByText('This placement overlaps an existing block.')).toBeInTheDocument()
    await waitFor(() => {
      const lastProps = viewportSpy.mock.calls.at(-1)?.[0] as {
        placementPreviewPosition: readonly number[] | null
        placementPreviewOverlaps: boolean
      }
      expect(lastProps.placementPreviewPosition).toEqual([0, 0, 0])
      expect(lastProps.placementPreviewOverlaps).toBe(true)
    })
  })

  it('keeps the current structure visible when opening is cancelled', async () => {
    const openStructureFile = vi.fn().mockResolvedValue({ ok: false, reason: 'cancelled' })
    window.frameLens = createApiMock({
      currentStructure: createStructure(),
      openStructureFile,
    })

    render(<App />)

    expect(await screen.findByText('restored.nbt')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open .nbt' }))

    await waitFor(() => expect(openStructureFile).toHaveBeenCalledOnce())
    expect(screen.getByText('restored.nbt')).toBeInTheDocument()
  })

  it('shows the active instance folder name after scanning asset sources', async () => {
    window.frameLens = createApiMock({
      currentStructure: createStructure(),
      scanAssetSources: vi.fn().mockResolvedValue({
        activeSourceId: 'instance-1',
        sources: [
          {
            id: 'instance-1',
            name: 'Better Blocks',
            rootPath: '/instances/Better Blocks',
            kind: 'instance',
            minecraftVersion: '1.21.4',
            archiveCount: 2,
            looseAssetRootCount: 1,
            hasVanillaJar: true,
            vanillaStatus: 'cached'
          }
        ]
      })
    })

    render(<App />)

    expect(await screen.findByText('restored.nbt')).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: 'Better Blocks' })).toBeInTheDocument()
  })

  it('adds blocks with a matching palette state so they render and export correctly', async () => {
    window.frameLens = createApiMock({
      currentStructure: {
        ...createStructure(),
        dimensions: { x: 2, y: 1, z: 1 }
      }
    })

    render(<App />)

    expect(await screen.findByText('restored.nbt')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const addDialog = screen.getByRole('dialog', { name: 'Add block' })
    fireEvent.change(screen.getByLabelText('Block'), { target: { value: 'minecraft:dirt' } })
    fireEvent.change(screen.getByLabelText('X'), { target: { value: '1' } })
    fireEvent.click(within(addDialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      const lastProps = viewportSpy.mock.calls.at(-1)?.[0] as { structure: LoadedStructure; visibleBlocks: readonly LoadedStructure['blocks'][number][] }
      const addedBlock = lastProps.visibleBlocks.find((block) => block.name === 'minecraft:dirt')
      expect(addedBlock).toMatchObject({ position: [1, 0, 0], state: 1 })
      expect(lastProps.structure.palette).toContainEqual({ index: 1, name: 'minecraft:dirt', properties: {} })
    })
  })

  it('creates editable data for a known container without existing block entity NBT', async () => {
    window.frameLens = createApiMock({
      currentStructure: {
        metadata: {
          fileName: 'containerless-barrel.nbt',
          byteSize: 256,
          paletteCount: 1,
          blockCount: 1,
          blockEntityCount: 0,
          entityCount: 0
        },
        dimensions: { x: 1, y: 1, z: 1 },
        palette: [{ index: 0, name: 'minecraft:barrel', properties: {} }],
        blocks: [{ position: [0, 0, 0], state: 0, name: 'minecraft:barrel', properties: {} }],
        entities: []
      }
    })

    render(<App />)

    expect(await screen.findByText('containerless-barrel.nbt')).toBeInTheDocument()
    fireEvent.click(screen.getByText('barrel').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: 'Edit block data' }))

    expect(screen.getByRole('dialog', { name: 'Block data' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Loot table' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('Loot seed')).toBeInTheDocument()
  })

  it('lets newly added chests choose between container items and lootable mode', async () => {
    window.frameLens = createApiMock({
      currentStructure: {
        ...createStructure(),
        dimensions: { x: 2, y: 1, z: 1 }
      }
    })

    render(<App />)

    expect(await screen.findByText('restored.nbt')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const addDialog = screen.getByRole('dialog', { name: 'Add block' })
    fireEvent.change(screen.getByLabelText('Block'), { target: { value: 'minecraft:chest' } })
    fireEvent.change(screen.getByLabelText('X'), { target: { value: '1' } })
    fireEvent.click(screen.getByLabelText('Block entity data'))
    expect(screen.getByRole('button', { name: 'Lootable' })).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Container' }))
    fireEvent.click(within(addDialog).getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      const lastProps = viewportSpy.mock.calls.at(-1)?.[0] as { visibleBlocks: readonly LoadedStructure['blocks'][number][] }
      const addedBlock = lastProps.visibleBlocks.find((block) => block.name === 'minecraft:chest')
      expect(addedBlock?.blockEntity).toMatchObject({ kind: 'container', containerMode: 'items', items: [] })
    })
  })

  it('autocompletes block names from detected asset blockstates', async () => {
    const listBlockAssetIds = vi.fn().mockResolvedValue(['minecraft:stone', 'supplementaries:ash_bricks'])
    const listDetectedBlockCapabilities = vi.fn().mockResolvedValue({})
    window.frameLens = createApiMock({
      currentStructure: {
        ...createStructure(),
        dimensions: { x: 2, y: 1, z: 1 }
      },
      scanAssetSources: vi.fn().mockResolvedValue({
        activeSourceId: 'instance-1',
        sources: [
          {
            id: 'instance-1',
            name: 'Modded Instance',
            rootPath: '/instances/Modded Instance',
            kind: 'instance',
            minecraftVersion: '1.20.1',
            archiveCount: 1,
            looseAssetRootCount: 1,
            hasVanillaJar: true,
            vanillaStatus: 'cached'
          }
        ]
      }),
      listBlockAssetIds,
      listDetectedBlockCapabilities
    })

    render(<App />)

    expect(await screen.findByText('restored.nbt')).toBeInTheDocument()
    await waitFor(() => expect(listBlockAssetIds).toHaveBeenCalledOnce())
    expect(listDetectedBlockCapabilities).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const blockInput = screen.getByLabelText('Block') as HTMLInputElement
    fireEvent.change(blockInput, { target: { value: 'ash' } })
    const option = await screen.findByRole('option', { name: 'supplementaries:ash_bricks' })
    fireEvent.mouseDown(option)

    expect(blockInput.value).toBe('supplementaries:ash_bricks')
  })

  it('uses detected modded capabilities when adding a container block', async () => {
    const detectBlockCapability = vi.fn().mockImplementation((blockName: string) =>
      Promise.resolve(blockName === 'reinfchest:iron' ? { kind: 'container', supportsLootTable: true } : null)
    )
    window.frameLens = createApiMock({
      currentStructure: {
        ...createStructure(),
        dimensions: { x: 2, y: 1, z: 1 }
      },
      scanAssetSources: vi.fn().mockResolvedValue({
        activeSourceId: 'instance-1',
        sources: [
          {
            id: 'instance-1',
            name: 'Modded Instance',
            rootPath: '/instances/Modded Instance',
            kind: 'instance',
            minecraftVersion: '1.20.1',
            archiveCount: 1,
            looseAssetRootCount: 0,
            hasVanillaJar: false,
            vanillaStatus: 'missing-version'
          }
        ]
      }),
      listBlockAssetIds: vi.fn().mockResolvedValue(['reinfchest:iron']),
      detectBlockCapability
    })

    render(<App />)

    expect(await screen.findByText('restored.nbt')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const blockInput = screen.getByLabelText('Block') as HTMLInputElement
    fireEvent.change(blockInput, { target: { value: 'iron' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'reinfchest:iron' }))

    await waitFor(() => expect(detectBlockCapability).toHaveBeenCalledWith('reinfchest:iron'))
    expect(screen.getByLabelText('Block entity data')).toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Block entity data'))
    expect(screen.getByRole('button', { name: 'Container' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Lootable' })).toBeInTheDocument()
  })

  it('upgrades modded generic block entities to container editing when their block is storage-like', async () => {
    window.frameLens = createApiMock({
      currentStructure: {
        metadata: {
          fileName: 'vault.nbt',
          byteSize: 256,
          paletteCount: 1,
          blockCount: 1,
          blockEntityCount: 1,
          entityCount: 0
        },
        dimensions: { x: 1, y: 1, z: 1 },
        palette: [{ index: 0, name: 'create:item_vault', properties: {} }],
        blocks: [
          {
            position: [0, 0, 0],
            state: 0,
            name: 'create:item_vault',
            properties: {},
            blockEntity: {
              id: 'create:item_vault',
              kind: 'generic',
              position: [0, 0, 0],
              fields: {}
            }
          }
        ],
        entities: []
      }
    })

    render(<App />)

    expect(await screen.findByText('vault.nbt')).toBeInTheDocument()
    fireEvent.click(screen.getByText('item_vault').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: 'Edit block data' }))

    expect(await screen.findByRole('button', { name: 'Items' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(await screen.findByDisplayValue('minecraft:stone')).toBeInTheDocument()
  })

  it('enables block data editing from learned capabilities for blocks without NBT', async () => {
    const detectBlockCapability = vi.fn().mockImplementation((blockName: string) =>
      Promise.resolve(blockName === 'modded:ancient_machine' ? { kind: 'container', supportsLootTable: false } : null)
    )
    window.frameLens = createApiMock({
      currentStructure: {
        metadata: {
          fileName: 'learned.nbt',
          byteSize: 256,
          paletteCount: 1,
          blockCount: 1,
          blockEntityCount: 0,
          entityCount: 0
        },
        dimensions: { x: 1, y: 1, z: 1 },
        palette: [{ index: 0, name: 'modded:ancient_machine', properties: {} }],
        blocks: [{ position: [0, 0, 0], state: 0, name: 'modded:ancient_machine', properties: {} }],
        entities: []
      },
      detectBlockCapability
    })

    render(<App />)

    expect(await screen.findByText('learned.nbt')).toBeInTheDocument()
    fireEvent.click(screen.getByText('ancient_machine').closest('button')!)
    fireEvent.click(screen.getByLabelText('Expand group'))
    fireEvent.click(screen.getByText('0, 0, 0').closest('button')!)
    const dataButton = screen.getByRole('button', { name: 'Data' })
    await waitFor(() => expect(detectBlockCapability).toHaveBeenCalledWith('modded:ancient_machine'))
    await waitFor(() => expect(dataButton).not.toBeDisabled())
    fireEvent.click(dataButton)
    expect(await screen.findByRole('button', { name: 'Items' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add item' }))
    expect(await screen.findByDisplayValue('minecraft:stone')).toBeInTheDocument()
  })

  it('autocompletes block names from the open structure palette without assets', async () => {
    window.frameLens = createApiMock({
      currentStructure: {
        ...createStructure(),
        palette: [{ index: 0, name: 'custom:machine_controller', properties: {} }],
        blocks: [{ position: [0, 0, 0], state: 0, name: 'custom:machine_controller', properties: {} }]
      }
    })

    render(<App />)

    expect(await screen.findByText('restored.nbt')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    const blockInput = screen.getByLabelText('Block') as HTMLInputElement
    fireEvent.change(blockInput, { target: { value: 'mach' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'custom:machine_controller' }))

    expect(blockInput.value).toBe('custom:machine_controller')
  })

  it('highlights grouped blocks and edits an expanded block entry', async () => {
    window.frameLens = createApiMock({
      currentStructure: {
        metadata: {
          fileName: 'jigsaw.nbt',
          byteSize: 256,
          paletteCount: 1,
          blockCount: 2,
          blockEntityCount: 2,
          entityCount: 0
        },
        dimensions: { x: 2, y: 1, z: 1 },
        palette: [{ index: 0, name: 'minecraft:jigsaw', properties: { orientation: 'north_up' } }],
        blocks: [
          {
            position: [0, 0, 0],
            state: 0,
            name: 'minecraft:jigsaw',
            properties: { orientation: 'north_up' },
            blockEntity: {
              id: 'minecraft:jigsaw',
              kind: 'jigsaw',
              position: [0, 0, 0],
              fields: { name: 'minecraft:start', target: 'minecraft:target', pool: 'minecraft:pool', final_state: 'minecraft:air', joint: 'rollable' }
            }
          },
          {
            position: [1, 0, 0],
            state: 0,
            name: 'minecraft:jigsaw',
            properties: { orientation: 'north_up' },
            blockEntity: {
              id: 'minecraft:jigsaw',
              kind: 'jigsaw',
              position: [1, 0, 0],
              fields: { name: 'minecraft:start', target: 'minecraft:target', pool: 'minecraft:pool', final_state: 'minecraft:air', joint: 'rollable' }
            }
          }
        ],
        entities: []
      }
    })

    render(<App />)

    expect(await screen.findByText('jigsaw.nbt')).toBeInTheDocument()
    fireEvent.click(screen.getByText('jigsaw').closest('button')!)
    expect(screen.getByText('orientation=north_up')).toBeInTheDocument()

    await waitFor(() => {
      const lastProps = viewportSpy.mock.calls.at(-1)?.[0] as { highlightedBlockKeys: readonly string[] }
      expect(lastProps.highlightedBlockKeys).toHaveLength(2)
    })

    fireEvent.click(screen.getAllByLabelText('Expand group')[0]!)
    fireEvent.click(screen.getAllByText('0, 0, 0')[0]!.closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: 'Properties' }))

    const orientationSelect = screen
      .getAllByRole('combobox')
      .find((element): element is HTMLSelectElement => element instanceof HTMLSelectElement && element.value === 'north_up')
    expect(orientationSelect).toBeDefined()
    expect(screen.getByRole('option', { name: 'south_up' })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Close editor' }))
    fireEvent.click(screen.getByRole('button', { name: 'Data' }))
    expect(screen.getByDisplayValue('minecraft:air')).toBeInTheDocument()

    await waitFor(() => {
      const lastProps = viewportSpy.mock.calls.at(-1)?.[0] as { highlightedBlockKeys: readonly string[] }
      expect(lastProps.highlightedBlockKeys).toEqual(['0,0,0'])
    })
  })

  it('edits item-backed container block entities', async () => {
    const listItemAssetIds = vi.fn().mockResolvedValue(['minecraft:diamond_sword'])
    window.frameLens = createApiMock({
      scanAssetSources: vi.fn().mockResolvedValue({
        activeSourceId: 'instance-1',
        sources: [
          {
            id: 'instance-1',
            name: 'Item Assets',
            rootPath: '/instances/Item Assets',
            kind: 'instance',
            minecraftVersion: '1.20.1',
            archiveCount: 1,
            looseAssetRootCount: 1,
            hasVanillaJar: true,
            vanillaStatus: 'cached'
          }
        ]
      }),
      listItemAssetIds,
      currentStructure: {
        metadata: {
          fileName: 'barrel.nbt',
          byteSize: 256,
          paletteCount: 1,
          blockCount: 1,
          blockEntityCount: 1,
          entityCount: 0
        },
        dimensions: { x: 1, y: 1, z: 1 },
        palette: [{ index: 0, name: 'minecraft:barrel', properties: {} }],
        blocks: [
          {
            position: [0, 0, 0],
            state: 0,
            name: 'minecraft:barrel',
            properties: {},
            blockEntity: {
              id: 'minecraft:barrel',
              kind: 'container',
              containerMode: 'items',
              position: [0, 0, 0],
              items: [{ slot: 3, id: 'minecraft:diamond', count: 12 }],
              fields: {}
            }
          }
        ],
        entities: []
      }
    })

    render(<App />)

    expect(await screen.findByText('barrel.nbt')).toBeInTheDocument()
    fireEvent.click(screen.getByText('barrel').closest('button')!)
    fireEvent.click(screen.getByRole('button', { name: 'Edit block data' }))
    expect(screen.getByRole('button', { name: 'Items' })).toHaveAttribute('aria-pressed', 'true')
    const itemInput = screen.getByDisplayValue('minecraft:diamond') as HTMLInputElement
    itemInput.focus()
    fireEvent.change(itemInput, { target: { value: 'm' } })
    await waitFor(() => expect(document.activeElement).toBe(itemInput))
    fireEvent.change(itemInput, { target: { value: 'sword' } })
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'minecraft:diamond_sword' }))
    expect(itemInput.value).toBe('minecraft:diamond_sword')
    expect(screen.getByDisplayValue('12')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Loot table' }))
    expect(screen.getByRole('button', { name: 'Loot table' })).toHaveAttribute('aria-pressed', 'true')
  })
})

interface ApiMockOptions {
  readonly currentStructure: LoadedStructure | null
  readonly openStructureFile?: () => Promise<OpenStructureResult>
  readonly scanAssetSources?: Window['frameLens']['scanAssetSources']
  readonly listBlockAssetIds?: Window['frameLens']['listBlockAssetIds']
  readonly listItemAssetIds?: Window['frameLens']['listItemAssetIds']
  readonly listDetectedBlockCapabilities?: Window['frameLens']['listDetectedBlockCapabilities']
  readonly detectBlockCapability?: Window['frameLens']['detectBlockCapability']
}

function createApiMock({
  currentStructure,
  openStructureFile = vi.fn(),
  scanAssetSources = vi.fn().mockResolvedValue({ sources: [], activeSourceId: null }),
  listBlockAssetIds = vi.fn().mockResolvedValue([]),
  listItemAssetIds = vi.fn().mockResolvedValue([]),
  listDetectedBlockCapabilities = vi.fn().mockResolvedValue({}),
  detectBlockCapability = vi.fn().mockResolvedValue(null)
}: ApiMockOptions): Window['frameLens'] {
  return {
    openStructureFile,
    getCurrentStructure: vi.fn().mockResolvedValue(currentStructure),
    updateCurrentStructure: vi.fn(),
    exportStructureFile: vi.fn().mockResolvedValue({ ok: false, reason: 'cancelled' }),
    scanAssetSources,
    chooseInstanceFolder: vi.fn().mockResolvedValue({ ok: false, source: null, cancelled: true }),
    activateAssetSource: vi.fn(),
    resolveBlockAssets: vi.fn().mockResolvedValue({ activeSource: null, assets: {} }),
    listBlockAssetIds,
    listItemAssetIds,
    listDetectedBlockCapabilities,
    detectBlockCapability
  }
}

function createStructure(): LoadedStructure {
  return {
    metadata: {
      fileName: 'restored.nbt',
      byteSize: 128,
      paletteCount: 1,
      blockCount: 1,
      blockEntityCount: 0,
      entityCount: 0
    },
    dimensions: { x: 1, y: 1, z: 1 },
    palette: [{ index: 0, name: 'minecraft:stone', properties: {} }],
    blocks: [{ position: [0, 0, 0], state: 0, name: 'minecraft:stone', properties: {} }],
    entities: []
  }
}
