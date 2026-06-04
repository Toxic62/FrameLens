import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Box, ChevronDown, ChevronRight, Crosshair, FolderOpen, Image, ListTree, Maximize2, Palette, RotateCcw } from 'lucide-react'
import { createBlockAssetKey } from '@shared/assets'
import type { AssetScanResult, AssetSourceSummary, BlockAssetRequest, RenderMode, ResolvedBlockAsset } from '@shared/assets'
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
  const [selectedBlockGroupKey, setSelectedBlockGroupKey] = useState<string | null>(null)
  const [showBlockList, setShowBlockList] = useState(false)
  const [expandedBlockGroups, setExpandedBlockGroups] = useState<ReadonlySet<string>>(new Set())
  const [paletteSearch, setPaletteSearch] = useState('')
  const [viewportCommand, setViewportCommand] = useState<ViewportCommand | null>(null)
  const [renderMode, setRenderMode] = useState<RenderMode>('debug')
  const [assetScan, setAssetScan] = useState<AssetScanResult>({ sources: [], activeSourceId: null })
  const [assetStatus, setAssetStatus] = useState('Choose an instance folder for textured rendering.')
  const [blockAssets, setBlockAssets] = useState<Readonly<Record<string, ResolvedBlockAsset>>>({})

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

  useEffect(() => {
    let isMounted = true

    window.frameLens
      .scanAssetSources()
      .then((scan) => {
        if (!isMounted) {
          return
        }

        setAssetScan(scan)
        if (scan.activeSourceId) {
          const source = scan.sources.find((candidate) => candidate.id === scan.activeSourceId)
          setAssetStatus(source ? formatAssetStatus(source) : 'Asset source selected.')
          setRenderMode('textured')
        } else {
          setAssetStatus('Choose an instance folder for textured rendering.')
        }
      })
      .catch(() => {
        if (isMounted) {
          setAssetStatus('Choose an instance folder for textured rendering.')
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
  const blockGroups = useMemo(() => (structure ? groupStructureBlocks(structure.blocks) : []), [structure])
  const highlightedBlockKeys = useMemo(() => {
    if (!structure) {
      return []
    }

    if (selectedBlockGroupKey) {
      return blockGroups.find((group) => group.key === selectedBlockGroupKey)?.blocks.map((block) => getBlockKey(block.position)) ?? []
    }

    return selectedBlockKey ? [selectedBlockKey] : []
  }, [blockGroups, selectedBlockGroupKey, selectedBlockKey, structure])
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
  const activeAssetSource = useMemo(
    () => assetScan.sources.find((source) => source.id === assetScan.activeSourceId),
    [assetScan]
  )
  const assetStats = useMemo(() => {
    const values = Object.values(blockAssets)
    return {
      textured: values.filter((asset) => asset.status === 'textured-cube').length,
      fallback: values.filter((asset) => asset.status === 'fallback').length
    }
  }, [blockAssets])

  useEffect(() => {
    if (structure) {
      setClipBounds(createDefaultClipBounds(structure.dimensions))
      setSelectedBlockKey(null)
      setSelectedBlockGroupKey(null)
      setExpandedBlockGroups(new Set())
      setPaletteSearch('')
    } else {
      setClipBounds(null)
      setSelectedBlockKey(null)
      setSelectedBlockGroupKey(null)
    }
  }, [structure])

  useEffect(() => {
    let isMounted = true
    const blockRequests = structure ? getUniqueBlockAssetRequests(structure.blocks) : []

    if (!structure || !assetScan.activeSourceId || blockRequests.length === 0) {
      setBlockAssets({})
      return undefined
    }

    setAssetStatus('Resolving block textures...')
    window.frameLens
      .resolveBlockAssets(blockRequests)
      .then((result) => {
        if (!isMounted) {
          return
        }

        setBlockAssets(result.assets)
        const texturedCount = Object.values(result.assets).filter((asset) => asset.status === 'textured-cube').length
        setAssetStatus(
          result.activeSource
            ? `${texturedCount}/${blockRequests.length} block textures resolved from ${result.activeSource.name}`
            : 'No asset source selected.'
        )
      })
      .catch(() => {
        if (isMounted) {
          setBlockAssets({})
          setAssetStatus('Texture resolution failed.')
        }
      })

    return () => {
      isMounted = false
    }
  }, [assetScan.activeSourceId, structure])

  useEffect(() => {
    if (selectedBlockKey !== null && !selectedBlock) {
      setSelectedBlockKey(null)
    }
  }, [selectedBlock, selectedBlockKey])

  function handleSelectBlock(block: RenderableBlock | null): void {
    setSelectedBlockKey(block ? getBlockKey(block.position) : null)
    setSelectedBlockGroupKey(null)
  }

  function handleSelectBlockGroup(groupKey: string): void {
    setSelectedBlockGroupKey(groupKey)
    setSelectedBlockKey(null)
  }

  function handleSelectBlockFromList(block: RenderableBlock): void {
    setSelectedBlockKey(getBlockKey(block.position))
    setSelectedBlockGroupKey(null)
  }

  function toggleBlockGroup(groupKey: string): void {
    setExpandedBlockGroups((current) => {
      const next = new Set(current)
      if (next.has(groupKey)) {
        next.delete(groupKey)
      } else {
        next.add(groupKey)
      }
      return next
    })
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

  async function handleChooseInstanceFolder(): Promise<void> {
    setAssetStatus('Selecting instance and preparing vanilla assets...')
    const result = await window.frameLens.chooseInstanceFolder()
    if (result.cancelled) {
      setAssetStatus(activeAssetSource ? formatAssetStatus(activeAssetSource) : 'Choose an instance folder for textured rendering.')
      return
    }

    if (!result.ok || !result.source) {
      setAssetStatus(result.message ?? 'Unable to use that instance folder.')
      return
    }

    const source = result.source
    setAssetScan((current) => ({
      sources: mergeAssetSources(current.sources, source),
      activeSourceId: source.id
    }))
    setRenderMode('textured')
    setAssetStatus(formatAssetStatus(source))
  }

  function updateBlockProperty(blockKey: string, propertyName: string, value: string): void {
    setLoadState((current) => {
      if (current.status !== 'loaded') {
        return current
      }

      return {
        status: 'loaded',
        structure: {
          ...current.structure,
          blocks: current.structure.blocks.map((block) =>
            getBlockKey(block.position) === blockKey
              ? { ...block, properties: { ...block.properties, [propertyName]: value } }
              : block
          )
        }
      }
    })
  }

  function updateBlockEntityField(blockKey: string, fieldName: string, value: string): void {
    setLoadState((current) => {
      if (current.status !== 'loaded') {
        return current
      }

      return {
        status: 'loaded',
        structure: {
          ...current.structure,
          blocks: current.structure.blocks.map((block) =>
            getBlockKey(block.position) === blockKey && block.blockEntity
              ? {
                  ...block,
                  blockEntity: {
                    ...block.blockEntity,
                    fields: {
                      ...block.blockEntity.fields,
                      [fieldName]: value
                    }
                  }
                }
              : block
          )
        }
      }
    })
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
                <Metadata label="Block entities" value={structure.metadata.blockEntityCount.toLocaleString()} />
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
              <div className="segmented-control" aria-label="Render mode">
                <RenderModeButton mode="debug" currentMode={renderMode} onClick={setRenderMode} />
                <RenderModeButton mode="palette" currentMode={renderMode} onClick={setRenderMode} />
                <RenderModeButton mode="textured" currentMode={renderMode} onClick={setRenderMode} />
              </div>
            </section>

            <section className="panel" aria-labelledby="assets-title">
              <div className="panel-heading">
                <h2 id="assets-title">Assets</h2>
              </div>
              <button className="tool-button full-width" type="button" onClick={() => void handleChooseInstanceFolder()}>
                <FolderOpen aria-hidden="true" size={16} />
                <span>{activeAssetSource ? 'Change instance' : 'Choose instance'}</span>
              </button>
              <p className="state-copy compact">{assetStatus}</p>
              {activeAssetSource && (
                <dl className="metadata-grid compact-grid">
                  <Metadata label="Instance" value={formatAssetSourceLabel(activeAssetSource)} />
                  <Metadata label="Version" value={activeAssetSource.minecraftVersion ?? 'Unknown'} />
                  <Metadata label="Vanilla" value={formatVanillaStatus(activeAssetSource)} />
                  <Metadata label="Archives" value={activeAssetSource.archiveCount.toLocaleString()} />
                  <Metadata label="Loose roots" value={activeAssetSource.looseAssetRootCount.toLocaleString()} />
                  <Metadata label="Textured" value={assetStats.textured.toLocaleString()} />
                  <Metadata label="Fallback" value={assetStats.fallback.toLocaleString()} />
                </dl>
              )}
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
                <SelectedBlockDetails
                  block={selectedBlock}
                  structure={structure}
                  onPropertyChange={updateBlockProperty}
                  onBlockEntityFieldChange={updateBlockEntityField}
                />
              ) : (
                <p className="state-copy compact">
                  {selectedBlockGroupKey ? 'Block group highlighted in the viewport.' : 'Select a visible block in the viewport.'}
                </p>
              )}
            </section>

            <section className="panel" aria-labelledby="block-list-title">
              <div className="panel-heading">
                <h2 id="block-list-title">Blocks</h2>
                <button className="text-button" type="button" onClick={() => setShowBlockList((current) => !current)}>
                  {showBlockList ? 'Hide' : 'Show'}
                </button>
              </div>
              {showBlockList ? (
                <BlockGroupList
                  groups={blockGroups}
                  expandedGroups={expandedBlockGroups}
                  selectedGroupKey={selectedBlockGroupKey}
                  selectedBlockKey={selectedBlockKey}
                  onToggleGroup={toggleBlockGroup}
                  onSelectGroup={handleSelectBlockGroup}
                  onSelectBlock={handleSelectBlockFromList}
                />
              ) : (
                <p className="state-copy compact">Grouped block list hidden.</p>
              )}
            </section>

            <section className="panel" aria-labelledby="block-entities-title">
              <div className="panel-heading">
                <h2 id="block-entities-title">Block Entities</h2>
              </div>
              <BlockEntityList blocks={structure.blocks} selectedBlockKey={selectedBlockKey} onSelectBlock={handleSelectBlockFromList} />
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
          highlightedBlockKeys={highlightedBlockKeys}
          renderMode={renderMode}
          blockAssets={blockAssets}
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

interface BlockGroup {
  readonly key: string
  readonly label: string
  readonly blocks: readonly RenderableBlock[]
}

interface BlockGroupListProps {
  readonly groups: readonly BlockGroup[]
  readonly expandedGroups: ReadonlySet<string>
  readonly selectedGroupKey: string | null
  readonly selectedBlockKey: string | null
  readonly onToggleGroup: (groupKey: string) => void
  readonly onSelectGroup: (groupKey: string) => void
  readonly onSelectBlock: (block: RenderableBlock) => void
}

function BlockGroupList({
  groups,
  expandedGroups,
  selectedGroupKey,
  selectedBlockKey,
  onToggleGroup,
  onSelectGroup,
  onSelectBlock
}: BlockGroupListProps): ReactElement {
  return (
    <ol className="list-panel block-group-list">
      {groups.map((group) => {
        const isExpanded = expandedGroups.has(group.key)
        return (
          <li className="block-group-item" key={group.key}>
            <div className="block-group-row">
              <button className="icon-button" type="button" onClick={() => onToggleGroup(group.key)} aria-label={isExpanded ? 'Collapse group' : 'Expand group'}>
                {isExpanded ? <ChevronDown aria-hidden="true" size={14} /> : <ChevronRight aria-hidden="true" size={14} />}
              </button>
              <button
                className="list-button"
                type="button"
                aria-pressed={selectedGroupKey === group.key}
                onClick={() => onSelectGroup(group.key)}
              >
                <span className="list-primary">{group.label}</span>
                <span className="list-count">{group.blocks.length.toLocaleString()}</span>
              </button>
            </div>
            {isExpanded && (
              <ol className="block-instance-list">
                {group.blocks.map((block) => {
                  const blockKey = getBlockKey(block.position)
                  return (
                    <li key={blockKey}>
                      <button
                        className="list-button nested"
                        type="button"
                        aria-pressed={selectedBlockKey === blockKey}
                        onClick={() => onSelectBlock(block)}
                      >
                        <span className="list-index">{block.position.join(', ')}</span>
                        <span className="list-primary">{block.blockEntity ? `${block.blockEntity.id}` : 'Block'}</span>
                      </button>
                    </li>
                  )
                })}
              </ol>
            )}
          </li>
        )
      })}
    </ol>
  )
}

interface BlockEntityListProps {
  readonly blocks: readonly RenderableBlock[]
  readonly selectedBlockKey: string | null
  readonly onSelectBlock: (block: RenderableBlock) => void
}

function BlockEntityList({ blocks, selectedBlockKey, onSelectBlock }: BlockEntityListProps): ReactElement {
  const blockEntityBlocks = blocks.filter((block) => block.blockEntity)
  if (blockEntityBlocks.length === 0) {
    return <p className="state-copy compact">No block entities.</p>
  }

  return (
    <ol className="list-panel action-list">
      {blockEntityBlocks.map((block) => {
        const blockKey = getBlockKey(block.position)
        return (
          <li key={blockKey}>
            <button
              className="list-button nested"
              type="button"
              aria-pressed={selectedBlockKey === blockKey}
              onClick={() => onSelectBlock(block)}
            >
              <span className="list-index">{block.position.join(', ')}</span>
              <span className="list-primary">{block.blockEntity?.id ?? block.name}</span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

interface SelectedBlockDetailsProps {
  readonly block: RenderableBlock
  readonly structure: LoadedStructure
  readonly onPropertyChange: (blockKey: string, propertyName: string, value: string) => void
  readonly onBlockEntityFieldChange: (blockKey: string, fieldName: string, value: string) => void
}

function SelectedBlockDetails({
  block,
  structure,
  onPropertyChange,
  onBlockEntityFieldChange
}: SelectedBlockDetailsProps): ReactElement {
  const properties = Object.entries(block.properties)
  const blockKey = getBlockKey(block.position)

  return (
    <div className="selection-details">
      <div className="selection-title">
        <Crosshair aria-hidden="true" size={16} />
        <span>{block.name}</span>
      </div>
      <dl className="metadata-grid compact-grid">
        <Metadata label="Position" value={block.position.join(', ')} />
        <Metadata label="State" value={block.state.toString()} />
        <Metadata label="Palette" value={structure.palette[block.state]?.name ?? block.name} />
      </dl>
      {properties.length > 0 ? (
        <dl className="property-grid">
          {properties.map(([key, value]) => (
            <div key={key}>
              <dt>{key}</dt>
              <dd>
                <PropertyValueEditor block={block} propertyName={key} value={value} onChange={(propertyName, nextValue) => onPropertyChange(blockKey, propertyName, nextValue)} />
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="state-copy compact">No palette properties.</p>
      )}
      {block.blockEntity && (
        <BlockEntityEditor block={block} onFieldChange={(fieldName, nextValue) => onBlockEntityFieldChange(blockKey, fieldName, nextValue)} />
      )}
    </div>
  )
}

interface PropertyValueEditorProps {
  readonly block: RenderableBlock
  readonly propertyName: string
  readonly value: string
  readonly onChange: (propertyName: string, value: string) => void
}

function PropertyValueEditor({ block, propertyName, value, onChange }: PropertyValueEditorProps): ReactElement {
  const options = getPropertyOptions(block, propertyName, value)
  const handleChange = (nextValue: string): void => onChange(propertyName, nextValue)
  return (
    <select
      className="select-input compact-input"
      value={value}
      onChange={(event) => handleChange(event.currentTarget.value)}
      onInput={(event) => handleChange(event.currentTarget.value)}
    >
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  )
}

interface BlockEntityEditorProps {
  readonly block: RenderableBlock
  readonly onFieldChange: (fieldName: string, value: string) => void
}

function BlockEntityEditor({ block, onFieldChange }: BlockEntityEditorProps): ReactElement {
  const blockEntity = block.blockEntity
  if (!blockEntity) {
    return <></>
  }

  const editableFields = getEditableBlockEntityFields(block)
  return (
    <div className="block-entity-editor">
      <div className="selection-title">
        <ListTree aria-hidden="true" size={16} />
        <span>{blockEntity.id}</span>
      </div>
      {editableFields.length > 0 ? (
        <dl className="property-grid">
          {editableFields.map((field) => (
            <div key={field.name}>
              <dt>{field.label}</dt>
              <dd>
                {field.options ? (
                  <select
                    className="select-input compact-input"
                    value={blockEntity.fields[field.name] ?? ''}
                    onChange={(event) => onFieldChange(field.name, event.target.value)}
                  >
                    {field.options.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="search-input compact-input"
                    value={blockEntity.fields[field.name] ?? ''}
                    onChange={(event) => onFieldChange(field.name, event.target.value)}
                  />
                )}
              </dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="state-copy compact">No simple editable block entity fields.</p>
      )}
    </div>
  )
}

interface RenderModeButtonProps {
  readonly mode: RenderMode
  readonly currentMode: RenderMode
  readonly onClick: (mode: RenderMode) => void
}

function RenderModeButton({ mode, currentMode, onClick }: RenderModeButtonProps): ReactElement {
  const label = mode === 'debug' ? 'Debug' : mode === 'palette' ? 'Palette' : 'Textured'
  const Icon = mode === 'debug' ? Box : mode === 'palette' ? Palette : Image

  return (
    <button
      className="segment-button"
      type="button"
      aria-pressed={mode === currentMode}
      onClick={() => onClick(mode)}
    >
      <Icon aria-hidden="true" size={15} />
      <span>{label}</span>
    </button>
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

function formatAssetSourceLabel(source: AssetSourceSummary): string {
  const version = source.minecraftVersion ? ` ${source.minecraftVersion}` : ''
  return `${source.name}${version}`
}

function formatAssetStatus(source: AssetSourceSummary): string {
  if (source.vanillaStatus === 'failed') {
    return `Using ${source.name}. ${source.vanillaMessage ?? 'Vanilla assets are unavailable.'}`
  }

  if (source.vanillaStatus === 'missing-version') {
    return `Using ${source.name}. Minecraft version was not detected.`
  }

  return `Using ${source.name} with ${formatVanillaStatus(source).toLowerCase()} vanilla assets.`
}

function formatVanillaStatus(source: AssetSourceSummary): string {
  if (source.vanillaStatus === 'downloaded') {
    return 'Downloaded'
  }

  if (source.vanillaStatus === 'cached') {
    return 'Cached'
  }

  if (source.vanillaStatus === 'failed') {
    return 'Failed'
  }

  return source.hasVanillaJar ? 'Found' : 'Missing'
}

function groupStructureBlocks(blocks: readonly RenderableBlock[]): readonly BlockGroup[] {
  const groups = new Map<string, RenderableBlock[]>()
  for (const block of blocks) {
    const key = createBlockAssetKey(block.name, block.properties)
    const group = groups.get(key)
    if (group) {
      group.push(block)
    } else {
      groups.set(key, [block])
    }
  }

  return [...groups.entries()]
    .map(([key, groupBlocks]) => ({
      key,
      label: formatBlockLabel(groupBlocks[0] ?? key),
      blocks: groupBlocks.sort((left, right) => getBlockKey(left.position).localeCompare(getBlockKey(right.position)))
    }))
    .sort((left, right) => right.blocks.length - left.blocks.length || left.label.localeCompare(right.label))
}

function formatBlockLabel(block: RenderableBlock | string): string {
  if (typeof block === 'string') {
    return block
  }

  const properties = Object.entries(block.properties)
  if (properties.length === 0) {
    return block.name
  }

  return `${block.name} [${properties.map(([key, value]) => `${key}=${value}`).join(', ')}]`
}

function getPropertyOptions(block: RenderableBlock, propertyName: string, currentValue: string): readonly string[] {
  const options = getKnownPropertyOptions(block, propertyName)
  return options.includes(currentValue) ? options : [currentValue, ...options]
}

function getKnownPropertyOptions(block: RenderableBlock, propertyName: string): readonly string[] {
  const blockName = block.name.toLowerCase()
  if (propertyName === 'axis') return ['x', 'y', 'z']
  if (propertyName === 'half') return ['top', 'bottom', 'upper', 'lower']
  if (propertyName === 'type') return ['bottom', 'top', 'double', 'single', 'left', 'right']
  if (propertyName === 'shape') return ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right', 'north_south', 'east_west', 'ascending_east', 'ascending_west', 'ascending_north', 'ascending_south']
  if (propertyName === 'waterlogged' || propertyName === 'lit' || propertyName === 'open' || propertyName === 'powered' || propertyName === 'occupied') return ['false', 'true']
  if (propertyName === 'facing') return ['north', 'east', 'south', 'west', 'up', 'down']
  if (propertyName === 'horizontal_facing') return ['north', 'east', 'south', 'west']
  if (propertyName === 'orientation') {
    return [
      'down_east',
      'down_north',
      'down_south',
      'down_west',
      'up_east',
      'up_north',
      'up_south',
      'up_west',
      'west_up',
      'east_up',
      'north_up',
      'south_up'
    ]
  }
  if (propertyName === 'face') return ['floor', 'wall', 'ceiling']
  if (propertyName === 'hinge') return ['left', 'right']
  if (propertyName === 'part') return ['head', 'foot']
  if (propertyName === 'mode') return ['save', 'load', 'corner', 'data']
  if (propertyName === 'instrument') return ['harp', 'basedrum', 'snare', 'hat', 'bass', 'flute', 'bell', 'guitar', 'chime', 'xylophone', 'iron_xylophone', 'cow_bell', 'didgeridoo', 'bit', 'banjo', 'pling']
  if (propertyName === 'delay') return ['1', '2', '3', '4']
  if (propertyName === 'layers') return ['1', '2', '3', '4', '5', '6', '7', '8']
  if (propertyName === 'level') return Array.from({ length: 16 }, (_, index) => index.toString())
  if (propertyName === 'rotation') return Array.from({ length: 16 }, (_, index) => index.toString())
  return [block.properties[propertyName] ?? '']
}

interface EditableBlockEntityField {
  readonly name: string
  readonly label: string
  readonly options?: readonly string[]
}

function getEditableBlockEntityFields(block: RenderableBlock): readonly EditableBlockEntityField[] {
  const blockEntity = block.blockEntity
  if (!blockEntity) {
    return []
  }

  if (blockEntity.kind === 'jigsaw') {
    return [
      { name: 'name', label: 'Name' },
      { name: 'target', label: 'Target' },
      { name: 'pool', label: 'Pool' },
      { name: 'target_pool', label: 'Target pool' },
      { name: 'final_state', label: 'Final state' },
      { name: 'joint', label: 'Joint', options: ['rollable', 'aligned'] },
      { name: 'selection_priority', label: 'Selection priority' },
      { name: 'placement_priority', label: 'Placement priority' }
    ].filter((field) => field.name in blockEntity.fields || ['name', 'target', 'pool', 'final_state', 'joint'].includes(field.name))
  }

  if (blockEntity.kind === 'container') {
    return [
      { name: 'LootTable', label: 'Loot table' },
      { name: 'LootTableSeed', label: 'Loot seed' }
    ]
  }

  return Object.keys(blockEntity.fields).map((name) => ({ name, label: name }))
}

function getUniqueBlockAssetRequests(blocks: readonly RenderableBlock[]): readonly BlockAssetRequest[] {
  const requests = new Map<string, BlockAssetRequest>()
  for (const block of blocks) {
    requests.set(createBlockAssetKey(block.name, block.properties), {
      blockName: block.name,
      properties: block.properties
    })
  }

  return [...requests.values()]
}

function mergeAssetSources(
  sources: readonly AssetSourceSummary[],
  source: AssetSourceSummary
): readonly AssetSourceSummary[] {
  const others = sources.filter((candidate) => candidate.id !== source.id)
  return [source, ...others]
}
