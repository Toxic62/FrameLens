import type { AssetActivationResult, AssetScanResult, BlockAssetRequest, ResolvedBlockAssetsResult } from './assets'
import type { ExportStructureResult, LoadedStructure, OpenStructureResult } from './structure'

export interface FrameLensApi {
  openStructureFile(): Promise<OpenStructureResult>
  getCurrentStructure(): Promise<LoadedStructure | null>
  exportStructureFile(structure: LoadedStructure): Promise<ExportStructureResult>
  scanAssetSources(): Promise<AssetScanResult>
  chooseInstanceFolder(): Promise<AssetActivationResult>
  activateAssetSource(sourceId: string): Promise<AssetActivationResult>
  resolveBlockAssets(blocks: readonly BlockAssetRequest[]): Promise<ResolvedBlockAssetsResult>
}
