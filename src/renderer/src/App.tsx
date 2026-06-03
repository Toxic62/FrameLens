import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Crosshair, FolderOpen, Maximize2, RotateCcw } from 'lucide-react'
import type { LoadedStructure, OpenStructureResult, RenderableBlock, StructureDimensions } from '@shared/structure'
import {
  createDefaultClipBounds,
  getBlockKey,
  getVisibleBlocks,
  isBlockVisible,
  type ClipAxis,
  type ClipBounds
} from '@shared/viewer'
import { StructureViewport, type ViewportCommand } from './components/StructureViewport'

type LoadState =
  | { readonly status: 'empty' }
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly structure: LoadedStructure }
  | { readonly status: 'error'; readonly message: string }

const initialState: LoadState = { status: 'empty' }

export default function App(): ReactElement {
  const [loadState, setLoadState] = useState<LoadState>(initialState)
  const [clipBounds, setClipBounds] = useState<ClipBounds | null>(null)
  const [selectedBlockKey, setSelectedBlockKey] = useState<string | null>(null)
  const [paletteSearch, setPaletteSearch] = useState('')
  const [viewportCommand, setViewportCommand] = useState<ViewportCommand | null>(null)

  useEffect(() => {
    let isMounted = true

    window.frameLens
      .getCurrentStructure()
      .then((structure) => {
        if (isMounted && structure) {
          setLoadState({ status: 'loaded', structure })
        }
      })
      .catch(() => {
        if (isMounted) {
          setLoadState(initialState)
        }
      })

    return () => {
      isMounted = false
    }
  }, [])

  async function handleOpenFile(): Promise<void> {
    setLoadState((current) => (current.status === 'loaded' ? current : { status: 'loading' }))

    const result = await window.frameLens.openStructureFile()
    applyOpenResult(result)
  }

  function applyOpenResult(result: OpenStructureResult): void {
    if (result.ok) {
      setLoadState({ status: 'loaded', structure: result.structure })
      return
    }

    if (result.reason === 'cancelled') {
      setLoadState((current) => (current.status === 'loading' ? initialState : current))
      return
    }

    setLoadState({
      status: 'error',
      message: result.message ?? 'Unable to open this structure file.'
    })
  }

  const structure = loadState.status === 'loaded' ? loadState.structure : undefined
  const visibleBlocks = useMemo(
    () => (structure && clipBounds ? getVisibleBlocks(structure.blocks, clipBounds) : []),
    [clipBounds, structure]
  )
  const selectedBlock = useMemo(() => {
    if (!structure || !clipBounds || selectedBlockKey === null) {
      return undefined
    }

    return structure.blocks.find((block) => getBlockKey(block.position) === selectedBlockKey && isBlockVisible(block, clipBounds))
  }, [clipBounds, selectedBlockKey, structure])
  const filteredPalette = useMemo(() => {
    if (!structure) {
      return []
    }

    const search = paletteSearch.trim().toLowerCase()
    if (search.length === 0) {
      return structure.palette
    }

    return structure.palette.filter((entry) => entry.name.toLowerCase().includes(search))
  }, [paletteSearch, structure])

  useEffect(() => {
    if (structure) {
      setClipBounds(createDefaultClipBounds(structure.dimensions))
      setSelectedBlockKey(null)
      setPaletteSearch('')
    } else {
      setClipBounds(null)
      setSelectedBlockKey(null)
    }
  }, [structure])

  useEffect(() => {
    if (selectedBlockKey !== null && !selectedBlock) {
      setSelectedBlockKey(null)
    }
  }, [selectedBlock, selectedBlockKey])

  function handleSelectBlock(block: RenderableBlock | null): void {
    setSelectedBlockKey(block ? getBlockKey(block.position) : null)
  }

  function updateClipBound(axis: ClipAxis, edge: 'Min' | 'Max', value: number): void {
    setClipBounds((current) => {
      if (!current) {
        return current
      }

      const minKey = `${axis}Min` as keyof ClipBounds
      const maxKey = `${axis}Max` as keyof ClipBounds
      const targetKey = `${axis}${edge}` as keyof ClipBounds
      const next = { ...current, [targetKey]: value }

      if (edge === 'Min' && value > current[maxKey]) {
        next[maxKey] = value
      }

      if (edge === 'Max' && value < current[minKey]) {
        next[minKey] = value
      }

      return next
    })
  }

  function resetClipping(): void {
    if (structure) {
      setClipBounds(createDefaultClipBounds(structure.dimensions))
    }
  }

  function sendViewportCommand(type: ViewportCommand['type']): void {
    setViewportCommand({ type, id: Date.now() })
  }

  return (
    <main className="app-shell">
      <aside className="sidebar" aria-label="Structure metadata">
        <div className="brand-block">
          <p className="eyebrow">FrameLens</p>
          <h1>Structure viewer</h1>
        </div>

        <button className="open-button" type="button" onClick={handleOpenFile} disabled={loadState.status === 'loading'}>
          <FolderOpen aria-hidden="true" size={18} strokeWidth={2.25} />
          <span>{loadState.status === 'loading' ? 'Opening...' : 'Open .nbt'}</span>
        </button>

        {loadState.status === 'empty' && (
          <p className="state-copy">Awaiting a Minecraft Java structure file.</p>
        )}

        {loadState.status === 'error' && <p className="error-copy">{loadState.message}</p>}

        {structure && (
          <div className="inspector-stack">
            <section className="panel" aria-labelledby="structure-summary-title">
              <div className="panel-heading">
                <h2 id="structure-summary-title">Structure</h2>
              </div>
              <dl className="metadata-grid">
                <Metadata label="File" value={structure.metadata.fileName} />
                <Metadata label="Size" value={formatBytes(structure.metadata.byteSize)} />
                <Metadata label="Dimensions" value={formatDimensions(structure.dimensions)} />
                <Metadata label="Palette" value={structure.metadata.paletteCount.toLocaleString()} />
                <Metadata label="Blocks" value={structure.metadata.blockCount.toLocaleString()} />
                <Metadata label="Non-air" value={structure.blocks.length.toLocaleString()} />
                <Metadata label="Visible" value={visibleBlocks.length.toLocaleString()} />
                <Metadata label="Entities" value={structure.metadata.entityCount.toLocaleString()} />
              </dl>
            </section>

            <section className="panel" aria-labelledby="viewport-controls-title">
              <div className="panel-heading">
                <h2 id="viewport-controls-title">Viewport</h2>
              </div>
              <div className="button-row">
                <button className="tool-button" type="button" onClick={() => sendViewportCommand('fit')}>
                  <Maximize2 aria-hidden="true" size={16} />
                  <span>Fit</span>
                </button>
                <button className="tool-button" type="button" onClick={() => sendViewportCommand('reset')}>
                  <RotateCcw aria-hidden="true" size={16} />
                  <span>Reset</span>
                </button>
              </div>
            </section>

            {clipBounds && (
              <section className="panel" aria-labelledby="clipping-title">
                <div className="panel-heading">
                  <h2 id="clipping-title">Clipping</h2>
                  <button className="text-button" type="button" onClick={resetClipping}>
                    Reset
                  </button>
                </div>
                <ClipAxisControl axis="x" label="X" dimensions={structure.dimensions} bounds={clipBounds} onChange={updateClipBound} />
                <ClipAxisControl axis="y" label="Y" dimensions={structure.dimensions} bounds={clipBounds} onChange={updateClipBound} />
                <ClipAxisControl axis="z" label="Z" dimensions={structure.dimensions} bounds={clipBounds} onChange={updateClipBound} />
              </section>
            )}

            <section className="panel" aria-labelledby="selected-block-title">
              <div className="panel-heading">
                <h2 id="selected-block-title">Selection</h2>
              </div>
              {selectedBlock ? (
                <SelectedBlockDetails block={selectedBlock} structure={structure} />
              ) : (
                <p className="state-copy compact">Select a visible block in the viewport.</p>
              )}
            </section>

            <section className="panel" aria-labelledby="palette-title">
              <div className="panel-heading">
                <h2 id="palette-title">Palette</h2>
              </div>
              <input
                className="search-input"
                type="search"
                placeholder="Search blocks"
                value={paletteSearch}
                onChange={(event) => setPaletteSearch(event.target.value)}
              />
              <ol className="list-panel palette-list">
                {filteredPalette.map((entry) => (
                  <li key={entry.index}>
                    <span className="list-index">{entry.index}</span>
                    <span className="list-primary">{entry.name}</span>
                  </li>
                ))}
              </ol>
            </section>

            <section className="panel" aria-labelledby="entities-title">
              <div className="panel-heading">
                <h2 id="entities-title">Entities</h2>
              </div>
              {structure.entities.length > 0 ? (
                <ol className="list-panel">
                  {structure.entities.map((entity, index) => (
                    <li key={`${entity.id}-${index}`}>
                      <span className="list-index">{index + 1}</span>
                      <span className="list-primary">{entity.id}</span>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="state-copy compact">No entities.</p>
              )}
            </section>
          </div>
        )}
      </aside>

      <section className="viewport-region" aria-label="Structure viewport">
        <StructureViewport
          structure={structure}
          visibleBlocks={visibleBlocks}
          selectedBlockKey={selectedBlockKey}
          viewportCommand={viewportCommand}
          onSelectBlock={handleSelectBlock}
        />
      </section>
    </main>
  )
}

interface MetadataProps {
  readonly label: string
  readonly value: string
}

function Metadata({ label, value }: MetadataProps): ReactElement {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  )
}

interface ClipAxisControlProps {
  readonly axis: ClipAxis
  readonly label: string
  readonly dimensions: StructureDimensions
  readonly bounds: ClipBounds
  readonly onChange: (axis: ClipAxis, edge: 'Min' | 'Max', value: number) => void
}

function ClipAxisControl({ axis, label, dimensions, bounds, onChange }: ClipAxisControlProps): ReactElement {
  const max = Math.max(dimensions[axis] - 1, 0)
  const minKey = `${axis}Min` as keyof ClipBounds
  const maxKey = `${axis}Max` as keyof ClipBounds

  return (
    <div className="clip-control">
      <div className="clip-label-row">
        <span>{label}</span>
        <span>
          {bounds[minKey]}-{bounds[maxKey]}
        </span>
      </div>
      <label>
        <span>Min</span>
        <input
          type="range"
          min={0}
          max={max}
          value={bounds[minKey]}
          onChange={(event) => onChange(axis, 'Min', Number(event.target.value))}
        />
      </label>
      <label>
        <span>Max</span>
        <input
          type="range"
          min={0}
          max={max}
          value={bounds[maxKey]}
          onChange={(event) => onChange(axis, 'Max', Number(event.target.value))}
        />
      </label>
    </div>
  )
}

interface SelectedBlockDetailsProps {
  readonly block: RenderableBlock
  readonly structure: LoadedStructure
}

function SelectedBlockDetails({ block, structure }: SelectedBlockDetailsProps): ReactElement {
  const paletteEntry = structure.palette[block.state]
  const properties = paletteEntry ? Object.entries(paletteEntry.properties) : []

  return (
    <div className="selection-details">
      <div className="selection-title">
        <Crosshair aria-hidden="true" size={16} />
        <span>{block.name}</span>
      </div>
      <dl className="metadata-grid compact-grid">
        <Metadata label="Position" value={block.position.join(', ')} />
        <Metadata label="State" value={block.state.toString()} />
      </dl>
      {properties.length > 0 ? (
        <dl className="property-grid">
          {properties.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="state-copy compact">No palette properties.</p>
      )}
    </div>
  )
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB']
  let size = bytes / 1024
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  return `${size.toFixed(size >= 10 ? 1 : 2)} ${units[unitIndex]}`
}

function formatDimensions(dimensions: StructureDimensions): string {
  return `${dimensions.x} x ${dimensions.y} x ${dimensions.z}`
}
