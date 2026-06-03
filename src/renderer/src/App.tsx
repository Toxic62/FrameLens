import { useState } from 'react'
import type { ReactElement } from 'react'
import { FolderOpen } from 'lucide-react'
import type { LoadedStructure, OpenStructureResult } from '@shared/structure'
import { StructureViewport } from './components/StructureViewport'

type LoadState =
  | { readonly status: 'empty' }
  | { readonly status: 'loading' }
  | { readonly status: 'loaded'; readonly structure: LoadedStructure }
  | { readonly status: 'error'; readonly message: string }

const initialState: LoadState = { status: 'empty' }

export default function App(): ReactElement {
  const [loadState, setLoadState] = useState<LoadState>(initialState)

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
          <dl className="metadata-grid">
            <div>
              <dt>File</dt>
              <dd>{structure.metadata.fileName}</dd>
            </div>
            <div>
              <dt>Size</dt>
              <dd>{formatBytes(structure.metadata.byteSize)}</dd>
            </div>
            <div>
              <dt>Palette</dt>
              <dd>{structure.metadata.paletteCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Blocks</dt>
              <dd>{structure.metadata.blockCount.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Entities</dt>
              <dd>{structure.metadata.entityCount.toLocaleString()}</dd>
            </div>
          </dl>
        )}
      </aside>

      <section className="viewport-region" aria-label="Structure viewport">
        <StructureViewport structure={structure} />
      </section>
    </main>
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
