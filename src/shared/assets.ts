export type RenderMode = 'debug' | 'palette' | 'textured'

export type AssetSourceKind = 'minecraft' | 'instance' | 'folder'

export interface AssetSourceSummary {
  readonly id: string
  readonly name: string
  readonly rootPath: string
  readonly kind: AssetSourceKind
  readonly minecraftVersion: string | null
  readonly archiveCount: number
  readonly looseAssetRootCount: number
  readonly hasVanillaJar: boolean
}

export interface AssetScanResult {
  readonly sources: readonly AssetSourceSummary[]
  readonly activeSourceId: string | null
}

export interface AssetActivationResult {
  readonly ok: boolean
  readonly source: AssetSourceSummary | null
  readonly message?: string
}

export interface BlockAssetRequest {
  readonly blockName: string
  readonly properties: Readonly<Record<string, string>>
}

export type BlockAssetStatus = 'textured-cube' | 'fallback'

export interface BlockFaceTextures {
  readonly up: string
  readonly down: string
  readonly north: string
  readonly south: string
  readonly east: string
  readonly west: string
}

export interface ResolvedBlockAsset {
  readonly assetKey: string
  readonly blockName: string
  readonly properties: Readonly<Record<string, string>>
  readonly status: BlockAssetStatus
  readonly sourceName: string | null
  readonly faces: BlockFaceTextures | null
  readonly fallbackColor: string
  readonly warning?: string
}

export interface ResolvedBlockAssetsResult {
  readonly activeSource: AssetSourceSummary | null
  readonly assets: Readonly<Record<string, ResolvedBlockAsset>>
}

export function createBlockAssetKey(blockName: string, properties: Readonly<Record<string, string>>): string {
  const propertyKey = Object.entries(properties)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(',')

  return propertyKey.length > 0 ? `${blockName}[${propertyKey}]` : blockName
}
