import { useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  Box,
  CheckSquare,
  ChevronDown,
  ChevronRight,
  Crosshair,
  Edit3,
  FileDown,
  FolderOpen,
  Image,
  ListTree,
  Maximize2,
  Palette,
  Plus,
  Redo2,
  RotateCcw,
  Trash2,
  Undo2,
  X
} from 'lucide-react'
import { createBlockAssetKey } from '@shared/assets'
import type { AssetScanResult, AssetSourceSummary, BlockAssetRequest, RenderMode, ResolvedBlockAsset } from '@shared/assets'
import type { BlockEntityKind, BlockPosition, LoadedStructure, OpenStructureResult, RenderableBlock, StructureDimensions } from '@shared/structure'
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

type SidebarSectionId = 'structure' | 'viewport' | 'assets' | 'clipping' | 'selection' | 'blocks' | 'entities'
type BlockEditorKind = 'properties' | 'data'

interface BlockEditorDialog {
  readonly kind: BlockEditorKind
  readonly blockKeys: readonly string[]
}

interface PlacementDialog {
  readonly mode: 'add' | 'transform'
  readonly position: [number, number, number]
  readonly sourceBlock?: RenderableBlock
}

export default function App(): ReactElement {
  const [loadState, setLoadState] = useState<LoadState>(initialState)
  const [clipBounds, setClipBounds] = useState<ClipBounds | null>(null)
  const [selectedBlockKey, setSelectedBlockKey] = useState<string | null>(null)
  const [selectedBlockGroupKey, setSelectedBlockGroupKey] = useState<string | null>(null)
  const [selectedBlockKeys, setSelectedBlockKeys] = useState<ReadonlySet<string>>(new Set())
  const [expandedBlockGroups, setExpandedBlockGroups] = useState<ReadonlySet<string>>(new Set())
  const [blockSearch, setBlockSearch] = useState('')
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<SidebarSectionId>>(new Set())
  const [editorDialog, setEditorDialog] = useState<BlockEditorDialog | null>(null)
  const [placementDialog, setPlacementDialog] = useState<PlacementDialog | null>(null)
  const [historyPast, setHistoryPast] = useState<readonly LoadedStructure[]>([])
  const [historyFuture, setHistoryFuture] = useState<readonly LoadedStructure[]>([])
  const [exportStatus, setExportStatus] = useState<string | null>(null)
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
      setHistoryPast([])
      setHistoryFuture([])
      setExportStatus(null)
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
  const filteredBlockGroups = useMemo(() => filterBlockGroups(blockGroups, blockSearch), [blockGroups, blockSearch])
  const highlightedBlockKeys = useMemo(() => {
    if (!structure) {
      return []
    }

    if (selectedBlockGroupKey) {
      return blockGroups.find((group) => group.key === selectedBlockGroupKey)?.blocks.map((block) => getBlockKey(block.position)) ?? []
    }

    if (selectedBlockKeys.size > 0) {
      return [...selectedBlockKeys]
    }

    return selectedBlockKey ? [selectedBlockKey] : []
  }, [blockGroups, selectedBlockGroupKey, selectedBlockKey, selectedBlockKeys, structure])
  const actionBlockKeys = useMemo(() => {
    if (!structure) {
      return []
    }

    if (selectedBlockGroupKey) {
      return blockGroups.find((group) => group.key === selectedBlockGroupKey)?.blocks.map((block) => getBlockKey(block.position)) ?? []
    }

    if (selectedBlockKeys.size > 0) {
      return [...selectedBlockKeys]
    }

    return selectedBlockKey ? [selectedBlockKey] : []
  }, [blockGroups, selectedBlockGroupKey, selectedBlockKey, selectedBlockKeys, structure])
  const dialogBlocks = useMemo(() => {
    if (!structure || !editorDialog) {
      return []
    }

    const keys = new Set(editorDialog.blockKeys)
    return structure.blocks.filter((block) => keys.has(getBlockKey(block.position)))
  }, [editorDialog, structure])
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
      setSelectedBlockKeys(new Set())
      setExpandedBlockGroups(new Set())
      setBlockSearch('')
      setEditorDialog(null)
      setPlacementDialog(null)
    } else {
      setClipBounds(null)
      setSelectedBlockKey(null)
      setSelectedBlockGroupKey(null)
      setSelectedBlockKeys(new Set())
    }
  }, [structure?.metadata.fileName, structure?.dimensions.x, structure?.dimensions.y, structure?.dimensions.z])

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
    setSelectedBlockKeys(new Set())
  }

  function handleSelectBlockGroup(groupKey: string): void {
    setSelectedBlockGroupKey(groupKey)
    setSelectedBlockKey(null)
    setSelectedBlockKeys(new Set())
  }

  function handleSelectBlockFromList(block: RenderableBlock): void {
    setSelectedBlockKey(getBlockKey(block.position))
    setSelectedBlockGroupKey(null)
    setSelectedBlockKeys(new Set())
  }

  function toggleBlockSelection(block: RenderableBlock): void {
    const blockKey = getBlockKey(block.position)
    setSelectedBlockGroupKey(null)
    setSelectedBlockKey(blockKey)
    setSelectedBlockKeys((current) => {
      const next = new Set(current)
      if (next.has(blockKey)) {
        next.delete(blockKey)
      } else {
        next.add(blockKey)
      }
      return next
    })
  }

  function toggleSection(sectionId: SidebarSectionId): void {
    setCollapsedSections((current) => {
      const next = new Set(current)
      if (next.has(sectionId)) {
        next.delete(sectionId)
      } else {
        next.add(sectionId)
      }
      return next
    })
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

  function updateLoadedStructure(updater: (structure: LoadedStructure) => LoadedStructure): void {
    if (loadState.status !== 'loaded') {
      return
    }

    const nextStructure = normalizeStructureMetadata(updater(loadState.structure))
    setHistoryPast((past) => [...past, loadState.structure])
    setHistoryFuture([])
    setExportStatus(null)
    setLoadState({ status: 'loaded', structure: nextStructure })
  }

  function updateBlockProperty(blockKey: string, propertyName: string, value: string): void {
    updateBlockProperties([blockKey], propertyName, value)
  }

  function updateBlockProperties(blockKeys: readonly string[], propertyName: string, value: string): void {
    const keySet = new Set(blockKeys)
    updateLoadedStructure((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        keySet.has(getBlockKey(block.position))
          ? { ...block, properties: { ...block.properties, [propertyName]: value } }
          : block
      )
    }))
  }

  function updateBlockEntityField(blockKey: string, fieldName: string, value: string): void {
    updateBlockEntityFields([blockKey], fieldName, value)
  }

  function updateBlockEntityFields(blockKeys: readonly string[], fieldName: string, value: string): void {
    const keySet = new Set(blockKeys)
    updateLoadedStructure((current) => ({
      ...current,
      blocks: current.blocks.map((block) =>
        keySet.has(getBlockKey(block.position)) && block.blockEntity
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
    }))
  }

  function deleteActionBlocks(): void {
    if (actionBlockKeys.length === 0) {
      return
    }

    const keySet = new Set(actionBlockKeys)
    updateLoadedStructure((current) => ({
      ...current,
      blocks: current.blocks.filter((block) => !keySet.has(getBlockKey(block.position)))
    }))
    setSelectedBlockKey(null)
    setSelectedBlockGroupKey(null)
    setSelectedBlockKeys(new Set())
    setEditorDialog(null)
  }

  function undoEdit(): void {
    const previous = historyPast.at(-1)
    if (!previous || loadState.status !== 'loaded') {
      return
    }

    setHistoryPast((past) => past.slice(0, -1))
    setHistoryFuture((future) => [loadState.structure, ...future])
    setLoadState({ status: 'loaded', structure: previous })
    setExportStatus(null)
  }

  function redoEdit(): void {
    const next = historyFuture[0]
    if (!next || loadState.status !== 'loaded') {
      return
    }

    setHistoryFuture((future) => future.slice(1))
    setHistoryPast((past) => [...past, loadState.structure])
    setLoadState({ status: 'loaded', structure: next })
    setExportStatus(null)
  }

  async function handleExportStructure(): Promise<void> {
    if (!structure) {
      return
    }

    setExportStatus('Exporting structure...')
    const result = await window.frameLens.exportStructureFile(structure)
    setExportStatus(result.ok ? `Exported ${getFileName(result.filePath)}` : result.reason === 'cancelled' ? null : (result.message ?? 'Export failed.'))
  }

  function openPlacementDialog(mode: PlacementDialog['mode']): void {
    if (!structure) {
      return
    }

    const sourceBlock = mode === 'transform' ? selectedBlock : undefined
    const fallbackPosition = selectedBlock?.position ?? structure.blocks[0]?.position ?? [0, 0, 0]
    setPlacementDialog({
      mode,
      position: [...fallbackPosition] as [number, number, number],
      ...(sourceBlock ? { sourceBlock } : {})
    })
  }

  function applyPlacedBlock(block: RenderableBlock, mode: PlacementDialog['mode']): void {
    const blockKey = getBlockKey(block.position)
    updateLoadedStructure((current) => {
      const withoutTarget = current.blocks.filter((candidate) => getBlockKey(candidate.position) !== blockKey)
      return {
        ...current,
        blocks: [...withoutTarget, block].sort((left, right) => getBlockKey(left.position).localeCompare(getBlockKey(right.position)))
      }
    })
    setSelectedBlockKey(blockKey)
    setSelectedBlockGroupKey(null)
    setSelectedBlockKeys(new Set([blockKey]))
    setPlacementDialog(null)
    if (mode === 'transform') {
      setEditorDialog(null)
    }
  }

  function updatePlacementPosition(position: BlockPosition): void {
    setPlacementDialog((current) => current ? { ...current, position: [...position] as [number, number, number] } : current)
  }

  return (
    <main className="app-shell">
      <header className="app-toolbar" aria-label="Application toolbar">
        <div className="toolbar-group">
          <button className="toolbar-button primary" type="button" onClick={handleOpenFile} disabled={loadState.status === 'loading'}>
            <FolderOpen aria-hidden="true" size={16} />
            <span>{loadState.status === 'loading' ? 'Opening...' : 'Open .nbt'}</span>
          </button>
          <button className="toolbar-button" type="button" onClick={() => void handleExportStructure()} disabled={!structure}>
            <FileDown aria-hidden="true" size={16} />
            <span>Export</span>
          </button>
          <button className="toolbar-button" type="button" onClick={() => void handleChooseInstanceFolder()}>
            <FolderOpen aria-hidden="true" size={16} />
            <span>{activeAssetSource ? 'Instance' : 'Select instance'}</span>
          </button>
        </div>
        <div className="toolbar-group">
          <button className="toolbar-button icon-label" type="button" onClick={undoEdit} disabled={historyPast.length === 0}>
            <Undo2 aria-hidden="true" size={16} />
            <span>Undo</span>
          </button>
          <button className="toolbar-button icon-label" type="button" onClick={redoEdit} disabled={historyFuture.length === 0}>
            <Redo2 aria-hidden="true" size={16} />
            <span>Redo</span>
          </button>
          <button className="toolbar-button" type="button" onClick={() => openPlacementDialog('add')} disabled={!structure}>
            <Plus aria-hidden="true" size={16} />
            <span>Add</span>
          </button>
          <button className="toolbar-button" type="button" onClick={() => openPlacementDialog('transform')} disabled={!selectedBlock}>
            <Edit3 aria-hidden="true" size={16} />
            <span>Transform</span>
          </button>
          <button className="toolbar-button danger" type="button" onClick={deleteActionBlocks} disabled={actionBlockKeys.length === 0}>
            <Trash2 aria-hidden="true" size={16} />
            <span>Delete</span>
          </button>
        </div>
      </header>
      <aside className="sidebar" aria-label="Structure metadata">
        <div className="brand-block">
          <p className="eyebrow">FrameLens</p>
          <h1>Structure viewer</h1>
        </div>

        {loadState.status === 'empty' && (
          <p className="state-copy">Awaiting a Minecraft Java structure file.</p>
        )}

        {loadState.status === 'error' && <p className="error-copy">{loadState.message}</p>}
        {exportStatus && <p className="state-copy compact">{exportStatus}</p>}

        {structure && (
          <div className="inspector-stack">
            <PanelSection id="structure" title="Structure" collapsedSections={collapsedSections} onToggle={toggleSection}>
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
            </PanelSection>

            <PanelSection id="viewport" title="Viewport" collapsedSections={collapsedSections} onToggle={toggleSection}>
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
            </PanelSection>

            <PanelSection id="assets" title="Assets" collapsedSections={collapsedSections} onToggle={toggleSection}>
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
            </PanelSection>

            {clipBounds && (
              <PanelSection id="clipping" title="Clipping" collapsedSections={collapsedSections} onToggle={toggleSection}>
                <div className="section-action-row">
                  <button className="text-button" type="button" onClick={resetClipping}>
                    Reset
                  </button>
                </div>
                <ClipAxisControl axis="x" label="X" dimensions={structure.dimensions} bounds={clipBounds} onChange={updateClipBound} />
                <ClipAxisControl axis="y" label="Y" dimensions={structure.dimensions} bounds={clipBounds} onChange={updateClipBound} />
                <ClipAxisControl axis="z" label="Z" dimensions={structure.dimensions} bounds={clipBounds} onChange={updateClipBound} />
              </PanelSection>
            )}

            <PanelSection id="selection" title="Selection" collapsedSections={collapsedSections} onToggle={toggleSection}>
              {selectedBlock ? (
                <SelectedBlockDetails
                  block={selectedBlock}
                  structure={structure}
                  onOpenProperties={(blockKey) => setEditorDialog({ kind: 'properties', blockKeys: [blockKey] })}
                  onOpenData={(blockKey) => setEditorDialog({ kind: 'data', blockKeys: [blockKey] })}
                />
              ) : (
                <p className="state-copy compact">
                  {actionBlockKeys.length > 0 ? `${actionBlockKeys.length.toLocaleString()} blocks selected.` : 'Select a visible block in the viewport.'}
                </p>
              )}
            </PanelSection>

            <PanelSection id="blocks" title="Blocks" collapsedSections={collapsedSections} onToggle={toggleSection}>
              <input
                className="search-input"
                type="search"
                placeholder="Filter blocks"
                value={blockSearch}
                onChange={(event) => setBlockSearch(event.target.value)}
              />
              <BlockGroupList
                groups={filteredBlockGroups}
                expandedGroups={expandedBlockGroups}
                selectedGroupKey={selectedBlockGroupKey}
                selectedBlockKey={selectedBlockKey}
                selectedBlockKeys={selectedBlockKeys}
                onToggleGroup={toggleBlockGroup}
                onSelectGroup={handleSelectBlockGroup}
                onSelectBlock={handleSelectBlockFromList}
                onToggleBlockSelection={toggleBlockSelection}
                onOpenProperties={(blockKeys) => setEditorDialog({ kind: 'properties', blockKeys })}
                onOpenData={(blockKeys) => setEditorDialog({ kind: 'data', blockKeys })}
              />
            </PanelSection>

            <PanelSection id="entities" title="Entities" collapsedSections={collapsedSections} onToggle={toggleSection}>
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
            </PanelSection>
          </div>
        )}
      </aside>

      <section className="viewport-region" aria-label="Structure viewport">
        <StructureViewport
          structure={structure}
          visibleBlocks={visibleBlocks}
          selectedBlockKey={selectedBlockKey}
          highlightedBlockKeys={highlightedBlockKeys}
          placementPreviewPosition={placementDialog?.position ?? null}
          renderMode={renderMode}
          blockAssets={blockAssets}
          viewportCommand={viewportCommand}
          onSelectBlock={handleSelectBlock}
        />
      </section>
      {editorDialog && structure && (
        <BlockEditorModal
          kind={editorDialog.kind}
          blocks={dialogBlocks}
          structure={structure}
          onClose={() => setEditorDialog(null)}
          onPropertyChange={updateBlockProperties}
          onBlockEntityFieldChange={updateBlockEntityFields}
        />
      )}
      {placementDialog && structure && (
        <PlacementModal
          dialog={placementDialog}
          structure={structure}
          onClose={() => setPlacementDialog(null)}
          onPositionChange={updatePlacementPosition}
          onApply={applyPlacedBlock}
        />
      )}
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

interface PanelSectionProps {
  readonly id: SidebarSectionId
  readonly title: string
  readonly collapsedSections: ReadonlySet<SidebarSectionId>
  readonly onToggle: (sectionId: SidebarSectionId) => void
  readonly children: ReactNode
}

function PanelSection({ id, title, collapsedSections, onToggle, children }: PanelSectionProps): ReactElement {
  const collapsed = collapsedSections.has(id)
  const titleId = `${id}-section-title`
  return (
    <section className="panel" aria-labelledby={titleId}>
      <div className="panel-heading">
        <h2 id={titleId}>{title}</h2>
        <button className="icon-button" type="button" onClick={() => onToggle(id)} aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}>
          {collapsed ? <ChevronRight aria-hidden="true" size={14} /> : <ChevronDown aria-hidden="true" size={14} />}
        </button>
      </div>
      {!collapsed && children}
    </section>
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
  readonly detail: string | null
  readonly title: string
  readonly blocks: readonly RenderableBlock[]
}

interface BlockGroupListProps {
  readonly groups: readonly BlockGroup[]
  readonly expandedGroups: ReadonlySet<string>
  readonly selectedGroupKey: string | null
  readonly selectedBlockKey: string | null
  readonly selectedBlockKeys: ReadonlySet<string>
  readonly onToggleGroup: (groupKey: string) => void
  readonly onSelectGroup: (groupKey: string) => void
  readonly onSelectBlock: (block: RenderableBlock) => void
  readonly onToggleBlockSelection: (block: RenderableBlock) => void
  readonly onOpenProperties: (blockKeys: readonly string[]) => void
  readonly onOpenData: (blockKeys: readonly string[]) => void
}

function BlockGroupList({
  groups,
  expandedGroups,
  selectedGroupKey,
  selectedBlockKey,
  selectedBlockKeys,
  onToggleGroup,
  onSelectGroup,
  onSelectBlock,
  onToggleBlockSelection,
  onOpenProperties,
  onOpenData
}: BlockGroupListProps): ReactElement {
  if (groups.length === 0) {
    return <p className="state-copy compact">No blocks match the filter.</p>
  }

  return (
    <ol className="list-panel block-group-list">
      {groups.map((group) => {
        const isExpanded = expandedGroups.has(group.key)
        const groupBlockKeys = group.blocks.map((block) => getBlockKey(block.position))
        const hasEditableProperties = group.blocks.some((block) => Object.keys(block.properties).length > 0)
        const hasBlockEntityData = group.blocks.some((block) => block.blockEntity)
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
                title={group.title}
              >
                <span className="list-primary">{group.label}</span>
                <span className="list-count">{group.blocks.length.toLocaleString()}</span>
                {group.detail && <span className="list-secondary">{group.detail}</span>}
              </button>
              <BlockRowActions
                disabledProperties={!hasEditableProperties}
                disabledData={!hasBlockEntityData}
                onOpenProperties={() => onOpenProperties(groupBlockKeys)}
                onOpenData={() => onOpenData(groupBlockKeys)}
              />
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
                      <button
                        className="icon-button"
                        type="button"
                        aria-pressed={selectedBlockKeys.has(blockKey)}
                        aria-label={selectedBlockKeys.has(blockKey) ? 'Remove from selection' : 'Add to selection'}
                        onClick={() => onToggleBlockSelection(block)}
                      >
                        <CheckSquare aria-hidden="true" size={14} />
                      </button>
                      <BlockRowActions
                        disabledProperties={Object.keys(block.properties).length === 0}
                        disabledData={!block.blockEntity}
                        onOpenProperties={() => onOpenProperties([blockKey])}
                        onOpenData={() => onOpenData([blockKey])}
                      />
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

interface BlockRowActionsProps {
  readonly disabledProperties: boolean
  readonly disabledData: boolean
  readonly onOpenProperties: () => void
  readonly onOpenData: () => void
}

function BlockRowActions({ disabledProperties, disabledData, onOpenProperties, onOpenData }: BlockRowActionsProps): ReactElement {
  return (
    <div className="row-actions">
      <button className="icon-button" type="button" aria-label="Edit block properties" onClick={onOpenProperties} disabled={disabledProperties}>
        <Edit3 aria-hidden="true" size={14} />
      </button>
      <button className="icon-button" type="button" aria-label="Edit block data" onClick={onOpenData} disabled={disabledData}>
        <ListTree aria-hidden="true" size={14} />
      </button>
    </div>
  )
}

interface SelectedBlockDetailsProps {
  readonly block: RenderableBlock
  readonly structure: LoadedStructure
  readonly onOpenProperties: (blockKey: string) => void
  readonly onOpenData: (blockKey: string) => void
}

function SelectedBlockDetails({
  block,
  structure,
  onOpenProperties,
  onOpenData
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
      <div className="button-row">
        <button className="tool-button" type="button" onClick={() => onOpenProperties(blockKey)} disabled={properties.length === 0}>
          <Edit3 aria-hidden="true" size={16} />
          <span>Properties</span>
        </button>
        <button className="tool-button" type="button" onClick={() => onOpenData(blockKey)} disabled={!block.blockEntity}>
          <ListTree aria-hidden="true" size={16} />
          <span>Data</span>
        </button>
      </div>
      {properties.length === 0 && !block.blockEntity && <p className="state-copy compact">No editable block properties or block entity data.</p>}
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

interface BlockEditorModalProps {
  readonly kind: BlockEditorKind
  readonly blocks: readonly RenderableBlock[]
  readonly structure: LoadedStructure
  readonly onClose: () => void
  readonly onPropertyChange: (blockKeys: readonly string[], propertyName: string, value: string) => void
  readonly onBlockEntityFieldChange: (blockKeys: readonly string[], fieldName: string, value: string) => void
}

function BlockEditorModal({
  kind,
  blocks,
  structure,
  onClose,
  onPropertyChange,
  onBlockEntityFieldChange
}: BlockEditorModalProps): ReactElement {
  const blockKeys = blocks.map((block) => getBlockKey(block.position))
  const propertyNames = [...new Set(blocks.flatMap((block) => Object.keys(block.properties)))].sort()
  const dataBlocks = blocks.filter((block) => block.blockEntity)
  const title = kind === 'properties' ? 'Block properties' : 'Block data'

  return (
    <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="editor-modal">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">{blocks.length.toLocaleString()} selected</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close editor">
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        {kind === 'properties' ? (
          propertyNames.length > 0 ? (
            <dl className="property-grid">
              {propertyNames.map((propertyName) => {
                const sampleBlock = blocks.find((block) => propertyName in block.properties)
                const value = getSharedPropertyValue(blocks, propertyName)
                return sampleBlock ? (
                  <div key={propertyName}>
                    <dt>{propertyName}</dt>
                    <dd>
                      <PropertyValueEditor
                        block={sampleBlock}
                        propertyName={propertyName}
                        value={value}
                        onChange={(name, nextValue) => onPropertyChange(blockKeys, name, nextValue)}
                      />
                    </dd>
                  </div>
                ) : null
              })}
            </dl>
          ) : (
            <p className="state-copy compact">No editable properties for this selection.</p>
          )
        ) : dataBlocks.length > 0 ? (
          <div className="modal-list">
            {dataBlocks.map((block) => {
              const blockKey = getBlockKey(block.position)
              return (
                <div className="modal-subpanel" key={blockKey}>
                  <dl className="metadata-grid compact-grid">
                    <Metadata label="Block" value={block.name} />
                    <Metadata label="Position" value={block.position.join(', ')} />
                  </dl>
                  <BlockEntityEditor block={block} onFieldChange={(fieldName, nextValue) => onBlockEntityFieldChange([blockKey], fieldName, nextValue)} />
                </div>
              )
            })}
          </div>
        ) : (
          <p className="state-copy compact">No block entity data for this selection.</p>
        )}
        <dl className="metadata-grid compact-grid">
          <Metadata label="Structure" value={structure.metadata.fileName} />
        </dl>
      </div>
    </div>
  )
}

interface PlacementModalProps {
  readonly dialog: PlacementDialog
  readonly structure: LoadedStructure
  readonly onClose: () => void
  readonly onPositionChange: (position: BlockPosition) => void
  readonly onApply: (block: RenderableBlock, mode: PlacementDialog['mode']) => void
}

function PlacementModal({ dialog, structure, onClose, onPositionChange, onApply }: PlacementModalProps): ReactElement {
  const position = dialog.position
  const [blockName, setBlockName] = useState(dialog.sourceBlock?.name ?? 'minecraft:stone')
  const [facing, setFacing] = useState(dialog.sourceBlock?.properties.facing ?? 'north')
  const [orientation, setOrientation] = useState(dialog.sourceBlock?.properties.orientation ?? 'north_up')
  const [withBlockEntity, setWithBlockEntity] = useState(Boolean(dialog.sourceBlock?.blockEntity))
  const [lootTable, setLootTable] = useState(dialog.sourceBlock?.blockEntity?.fields.LootTable ?? '')
  const [jigsawName, setJigsawName] = useState(dialog.sourceBlock?.blockEntity?.fields.name ?? '')

  const supportsFacing = blockSupportsFacing(blockName)
  const supportsOrientation = blockSupportsOrientation(blockName)
  const blockEntityKind = inferEditableBlockEntityKind(blockName)
  const canHaveBlockEntity = blockEntityKind !== null
  const title = dialog.mode === 'add' ? 'Add block' : 'Transform block'

  function setAxis(axis: 0 | 1 | 2, value: number): void {
    const next: [number, number, number] = [...position]
    next[axis] = clampInteger(value, 0, axis === 0 ? structure.dimensions.x - 1 : axis === 1 ? structure.dimensions.y - 1 : structure.dimensions.z - 1)
    onPositionChange(next)
  }

  function apply(): void {
    const properties: Record<string, string> = {}
    if (supportsFacing) {
      properties.facing = facing
    }
    if (supportsOrientation) {
      properties.orientation = orientation
    }

    const blockEntity = withBlockEntity && blockEntityKind
      ? {
          id: blockName,
          kind: blockEntityKind,
          position,
          fields: blockEntityKind === 'jigsaw'
            ? { name: jigsawName, target: '', pool: '', final_state: 'minecraft:air', joint: 'rollable' }
            : blockEntityKind === 'container'
              ? { LootTable: lootTable }
              : {}
        }
      : undefined

    onApply(
      {
        position,
        state: structure.palette.length,
        name: normalizeBlockName(blockName),
        properties,
        ...(blockEntity ? { blockEntity } : {})
      },
      dialog.mode
    )
  }

  return (
    <div className="placement-layer" role="dialog" aria-modal="true" aria-label={title}>
      <div className="placement-panel">
        <div className="modal-heading">
          <div>
            <p className="eyebrow">Placement {position.join(', ')}</p>
            <h2>{title}</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="Close placement">
            <X aria-hidden="true" size={16} />
          </button>
        </div>
        <div className="placement-grid">
          <label className="field-label placement-block-field">
            <span>Block</span>
            <input className="search-input" value={blockName} onChange={(event) => setBlockName(event.target.value)} />
          </label>
          <div className="coordinate-grid">
            {(['X', 'Y', 'Z'] as const).map((label, index) => (
              <label className="field-label" key={label}>
                <span>{label}</span>
                <input
                  className="search-input compact-input"
                  type="number"
                  min={0}
                  max={index === 0 ? structure.dimensions.x - 1 : index === 1 ? structure.dimensions.y - 1 : structure.dimensions.z - 1}
                  value={position[index]}
                  onChange={(event) => setAxis(index as 0 | 1 | 2, Number(event.target.value))}
                />
              </label>
            ))}
          </div>
          <div className="nudge-grid" aria-label="Coordinate nudges">
            <button className="tool-button" type="button" onClick={() => setAxis(0, position[0] - 1)}>-X</button>
            <button className="tool-button" type="button" onClick={() => setAxis(0, position[0] + 1)}>+X</button>
            <button className="tool-button" type="button" onClick={() => setAxis(1, position[1] - 1)}>-Y</button>
            <button className="tool-button" type="button" onClick={() => setAxis(1, position[1] + 1)}>+Y</button>
            <button className="tool-button" type="button" onClick={() => setAxis(2, position[2] - 1)}>-Z</button>
            <button className="tool-button" type="button" onClick={() => setAxis(2, position[2] + 1)}>+Z</button>
          </div>
        </div>
        {supportsFacing && (
          <label className="field-label">
            <span>Facing</span>
            <select className="select-input" value={facing} onChange={(event) => setFacing(event.target.value)}>
              {['north', 'east', 'south', 'west', 'up', 'down'].map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        )}
        {supportsOrientation && (
          <label className="field-label">
            <span>Orientation</span>
            <select className="select-input" value={orientation} onChange={(event) => setOrientation(event.target.value)}>
              {getKnownPropertyOptions({ position, state: 0, name: normalizeBlockName(blockName), properties: { orientation } }, 'orientation').map((option) => <option key={option} value={option}>{option}</option>)}
            </select>
          </label>
        )}
        {canHaveBlockEntity && (
          <label className="checkbox-row">
            <input type="checkbox" checked={withBlockEntity} onChange={(event) => setWithBlockEntity(event.target.checked)} />
            <span>Block entity data</span>
          </label>
        )}
        {withBlockEntity && blockEntityKind === 'container' && (
          <label className="field-label">
            <span>Loot table</span>
            <input className="search-input" value={lootTable} onChange={(event) => setLootTable(event.target.value)} />
          </label>
        )}
        {withBlockEntity && blockEntityKind === 'jigsaw' && (
          <label className="field-label">
            <span>Name</span>
            <input className="search-input" value={jigsawName} onChange={(event) => setJigsawName(event.target.value)} />
          </label>
        )}
        <div className="button-row">
          <button className="tool-button" type="button" onClick={onClose}>Cancel</button>
          <button className="tool-button primary-action" type="button" onClick={apply}>{dialog.mode === 'add' ? 'Add' : 'Transform'}</button>
        </div>
      </div>
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

function normalizeStructureMetadata(structure: LoadedStructure): LoadedStructure {
  return {
    ...structure,
    metadata: {
      ...structure.metadata,
      blockCount: structure.blocks.length,
      paletteCount: countUniquePaletteEntries(structure.blocks, structure.palette),
      blockEntityCount: structure.blocks.filter((block) => block.blockEntity).length,
      entityCount: structure.entities.length
    }
  }
}

function countUniquePaletteEntries(blocks: readonly RenderableBlock[], palette: LoadedStructure['palette']): number {
  const keys = new Set(palette.map((entry) => createBlockAssetKey(entry.name, entry.properties)))
  for (const block of blocks) {
    keys.add(createBlockAssetKey(block.name, block.properties))
  }
  return keys.size
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
      label: formatCompactBlockLabel(groupBlocks[0] ?? key),
      detail: typeof groupBlocks[0] === 'object' ? formatCompactPropertySummary(groupBlocks[0].properties) : null,
      title: formatBlockLabel(groupBlocks[0] ?? key),
      blocks: groupBlocks.sort((left, right) => getBlockKey(left.position).localeCompare(getBlockKey(right.position)))
    }))
    .sort((left, right) => right.blocks.length - left.blocks.length || left.label.localeCompare(right.label))
}

function filterBlockGroups(groups: readonly BlockGroup[], searchValue: string): readonly BlockGroup[] {
  const search = searchValue.trim().toLowerCase()
  if (search.length === 0) {
    return groups
  }

  return groups.flatMap((group) => {
    const groupMatches = group.label.toLowerCase().includes(search)
    const blocks = groupMatches
      ? group.blocks
      : group.blocks.filter((block) => {
          const position = block.position.join(', ')
          const entity = block.blockEntity?.id ?? ''
          return block.name.toLowerCase().includes(search) || position.includes(search) || entity.toLowerCase().includes(search)
        })

    return blocks.length > 0 ? [{ ...group, blocks }] : []
  })
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

function formatCompactBlockLabel(block: RenderableBlock | string): string {
  const blockName = typeof block === 'string' ? block.split('[')[0] ?? block : block.name
  return blockName.split(':').at(-1) ?? blockName
}

function formatCompactPropertySummary(properties: Readonly<Record<string, string>>): string | null {
  const entries = Object.entries(properties)
  if (entries.length === 0) {
    return null
  }

  const [firstKey, firstValue] = entries[0] ?? []
  if (!firstKey || firstValue === undefined) {
    return null
  }

  return entries.length === 1 ? `${firstKey}=${firstValue}` : `${firstKey}=${firstValue} +${entries.length - 1}`
}

function getSharedPropertyValue(blocks: readonly RenderableBlock[], propertyName: string): string {
  const values = [...new Set(blocks.map((block) => block.properties[propertyName]).filter((value): value is string => value !== undefined))]
  return values.length === 1 ? values[0] ?? '' : ''
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

function getFileName(filePath: string): string {
  return filePath.split(/[\\/]/).at(-1) ?? filePath
}

function normalizeBlockName(blockName: string): string {
  const trimmed = blockName.trim()
  if (trimmed.length === 0) {
    return 'minecraft:air'
  }
  return trimmed.includes(':') ? trimmed : `minecraft:${trimmed}`
}

function blockSupportsFacing(blockName: string): boolean {
  const normalized = normalizeBlockName(blockName).toLowerCase()
  return /chest|barrel|furnace|hopper|dispenser|dropper|observer|piston|stairs|door|trapdoor|ladder|button|lever|grindstone|jigsaw/.test(normalized)
}

function blockSupportsOrientation(blockName: string): boolean {
  return normalizeBlockName(blockName).toLowerCase().includes('jigsaw')
}

function inferEditableBlockEntityKind(blockName: string): BlockEntityKind | null {
  const normalized = normalizeBlockName(blockName).toLowerCase()
  if (normalized.includes('jigsaw')) {
    return 'jigsaw'
  }
  if (/chest|barrel|shulker_box|dispenser|dropper/.test(normalized)) {
    return 'container'
  }
  return null
}

function clampInteger(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) {
    return min
  }
  return Math.min(Math.max(Math.round(value), min), Math.max(min, max))
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
