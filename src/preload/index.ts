import { contextBridge, ipcRenderer } from 'electron'
import type { FrameLensApi } from '@shared/api'
import {
  ACTIVATE_ASSET_SOURCE_CHANNEL,
  CHOOSE_INSTANCE_FOLDER_CHANNEL,
  EXPORT_STRUCTURE_CHANNEL,
  GET_CURRENT_STRUCTURE_CHANNEL,
  OPEN_STRUCTURE_CHANNEL,
  RESOLVE_BLOCK_ASSETS_CHANNEL,
  SCAN_ASSET_SOURCES_CHANNEL
} from '@shared/ipc'
import type { AssetActivationResult, AssetScanResult, BlockAssetRequest, ResolvedBlockAssetsResult } from '@shared/assets'
import type { ExportStructureResult, LoadedStructure, OpenStructureResult } from '@shared/structure'

const api: FrameLensApi = {
  openStructureFile: () => ipcRenderer.invoke(OPEN_STRUCTURE_CHANNEL) as Promise<OpenStructureResult>,
  getCurrentStructure: () => ipcRenderer.invoke(GET_CURRENT_STRUCTURE_CHANNEL) as Promise<LoadedStructure | null>,
  exportStructureFile: (structure) =>
    ipcRenderer.invoke(EXPORT_STRUCTURE_CHANNEL, structure) as Promise<ExportStructureResult>,
  scanAssetSources: () => ipcRenderer.invoke(SCAN_ASSET_SOURCES_CHANNEL) as Promise<AssetScanResult>,
  chooseInstanceFolder: () => ipcRenderer.invoke(CHOOSE_INSTANCE_FOLDER_CHANNEL) as Promise<AssetActivationResult>,
  activateAssetSource: (sourceId) =>
    ipcRenderer.invoke(ACTIVATE_ASSET_SOURCE_CHANNEL, sourceId) as Promise<AssetActivationResult>,
  resolveBlockAssets: (blocks: readonly BlockAssetRequest[]) =>
    ipcRenderer.invoke(RESOLVE_BLOCK_ASSETS_CHANNEL, blocks) as Promise<ResolvedBlockAssetsResult>
}

contextBridge.exposeInMainWorld('frameLens', api)
