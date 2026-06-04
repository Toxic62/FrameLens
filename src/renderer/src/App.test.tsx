// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
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
    expect(screen.getByText('minecraft:stone')).toBeInTheDocument()
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
    fireEvent.click(screen.getByText('minecraft:jigsaw [orientation=north_up]'))

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
})

interface ApiMockOptions {
  readonly currentStructure: LoadedStructure | null
  readonly openStructureFile?: () => Promise<OpenStructureResult>
}

function createApiMock({ currentStructure, openStructureFile = vi.fn() }: ApiMockOptions): Window['frameLens'] {
  return {
    openStructureFile,
    getCurrentStructure: vi.fn().mockResolvedValue(currentStructure),
    exportStructureFile: vi.fn().mockResolvedValue({ ok: false, reason: 'cancelled' }),
    scanAssetSources: vi.fn().mockResolvedValue({ sources: [], activeSourceId: null }),
    chooseInstanceFolder: vi.fn().mockResolvedValue({ ok: false, source: null, cancelled: true }),
    activateAssetSource: vi.fn(),
    resolveBlockAssets: vi.fn().mockResolvedValue({ activeSource: null, assets: {} })
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
