import type { AssetActivationResult, AssetScanResult, BlockAssetRequest, ResolvedBlockAssetsResult } from './assets'
import type { LoadedStructure, OpenStructureResult } from './structure'

export interface FrameLensApi {
  openStructureFile(): Promise<OpenStructureResult>
  getCurrentStructure(): Promise<LoadedStructure | null>
  scanAssetSources(): Promise<AssetScanResult>
  activateAssetSource(sourceId: string): Promise<AssetActivationResult>
  resolveBlockAssets(blocks: readonly BlockAssetRequest[]): Promise<ResolvedBlockAssetsResult>
}
