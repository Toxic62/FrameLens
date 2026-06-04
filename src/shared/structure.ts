export type BlockPosition = readonly [x: number, y: number, z: number]

export interface StructureDimensions {
  readonly x: number
  readonly y: number
  readonly z: number
}

export interface PaletteEntry {
  readonly index: number
  readonly name: string
  readonly properties: Readonly<Record<string, string>>
}

export type BlockEntityKind = 'jigsaw' | 'container' | 'generic'

export interface BlockEntitySummary {
  readonly id: string
  readonly kind: BlockEntityKind
  readonly position: BlockPosition
  readonly fields: Readonly<Record<string, string>>
}

export interface RenderableBlock {
  readonly position: BlockPosition
  readonly state: number
  readonly name: string
  readonly properties: Readonly<Record<string, string>>
  readonly blockEntity?: BlockEntitySummary
}

export interface EntitySummary {
  readonly id: string
}

export interface LoadedStructureMetadata {
  readonly fileName: string
  readonly byteSize: number
  readonly paletteCount: number
  readonly blockCount: number
  readonly blockEntityCount: number
  readonly entityCount: number
}

export interface LoadedStructure {
  readonly metadata: LoadedStructureMetadata
  readonly dimensions: StructureDimensions
  readonly palette: readonly PaletteEntry[]
  readonly blocks: readonly RenderableBlock[]
  readonly entities: readonly EntitySummary[]
}

export type OpenStructureResult =
  | { readonly ok: true; readonly structure: LoadedStructure }
  | {
      readonly ok: false
      readonly reason: 'cancelled' | 'parse-error' | 'io-error' | 'unsupported-format'
      readonly message?: string
    }
