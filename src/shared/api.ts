import type { AssetActivationResult, AssetScanResult, BlockAssetRequest, ResolvedBlockAssetsResult } from './assets'
import type { BlockEntityCapability } from './blockCapabilities'
import type { ExportStructureResult, LoadedStructure, OpenStructureResult } from './structure'

export interface FrameLensApi {
  openStructureFile(): Promise<OpenStructureResult>
  getCurrentStructure(): Promise<LoadedStructure | null>
  updateCurrentStructure(structure: LoadedStructure, hasUnsavedChanges: boolean): void
  exportStructureFile(structure: LoadedStructure): Promise<ExportStructureResult>
  scanAssetSources(): Promise<AssetScanResult>
  chooseInstanceFolder(): Promise<AssetActivationResult>
  activateAssetSource(sourceId: string): Promise<AssetActivationResult>
  resolveBlockAssets(blocks: readonly BlockAssetRequest[]): Promise<ResolvedBlockAssetsResult>
  listBlockAssetIds(): Promise<readonly string[]>
  listItemAssetIds(): Promise<readonly string[]>
  listDetectedBlockCapabilities(): Promise<Readonly<Record<string, BlockEntityCapability>>>
  detectBlockCapability(blockName: string): Promise<BlockEntityCapability | null>
}
