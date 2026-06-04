import { contextBridge, ipcRenderer } from 'electron'
import type { FrameLensApi } from '@shared/api'
import {
  ACTIVATE_ASSET_SOURCE_CHANNEL,
  CHOOSE_INSTANCE_FOLDER_CHANNEL,
  DETECT_BLOCK_CAPABILITY_CHANNEL,
  EXPORT_STRUCTURE_CHANNEL,
  GET_CURRENT_STRUCTURE_CHANNEL,
  LIST_BLOCK_ASSET_IDS_CHANNEL,
  LIST_DETECTED_BLOCK_CAPABILITIES_CHANNEL,
  LIST_ITEM_ASSET_IDS_CHANNEL,
  OPEN_STRUCTURE_CHANNEL,
  RESOLVE_BLOCK_ASSETS_CHANNEL,
  SCAN_ASSET_SOURCES_CHANNEL,
  UPDATE_CURRENT_STRUCTURE_CHANNEL
} from '@shared/ipc'
import type { AssetActivationResult, AssetScanResult, BlockAssetRequest, ResolvedBlockAssetsResult } from '@shared/assets'
import type { BlockEntityCapability } from '@shared/blockCapabilities'
import type { ExportStructureResult, LoadedStructure, OpenStructureResult } from '@shared/structure'

const api: FrameLensApi = {
  openStructureFile: () => ipcRenderer.invoke(OPEN_STRUCTURE_CHANNEL) as Promise<OpenStructureResult>,
  getCurrentStructure: () => ipcRenderer.invoke(GET_CURRENT_STRUCTURE_CHANNEL) as Promise<LoadedStructure | null>,
  updateCurrentStructure: (structure, hasUnsavedChanges) => {
    ipcRenderer.send(UPDATE_CURRENT_STRUCTURE_CHANNEL, structure, hasUnsavedChanges)
  },
  exportStructureFile: (structure) =>
    ipcRenderer.invoke(EXPORT_STRUCTURE_CHANNEL, structure) as Promise<ExportStructureResult>,
  scanAssetSources: () => ipcRenderer.invoke(SCAN_ASSET_SOURCES_CHANNEL) as Promise<AssetScanResult>,
  chooseInstanceFolder: () => ipcRenderer.invoke(CHOOSE_INSTANCE_FOLDER_CHANNEL) as Promise<AssetActivationResult>,
  activateAssetSource: (sourceId) =>
    ipcRenderer.invoke(ACTIVATE_ASSET_SOURCE_CHANNEL, sourceId) as Promise<AssetActivationResult>,
  resolveBlockAssets: (blocks: readonly BlockAssetRequest[]) =>
    ipcRenderer.invoke(RESOLVE_BLOCK_ASSETS_CHANNEL, blocks) as Promise<ResolvedBlockAssetsResult>,
  listBlockAssetIds: () => ipcRenderer.invoke(LIST_BLOCK_ASSET_IDS_CHANNEL) as Promise<readonly string[]>,
  listItemAssetIds: () => ipcRenderer.invoke(LIST_ITEM_ASSET_IDS_CHANNEL) as Promise<readonly string[]>,
  listDetectedBlockCapabilities: () =>
    ipcRenderer.invoke(LIST_DETECTED_BLOCK_CAPABILITIES_CHANNEL) as Promise<Readonly<Record<string, BlockEntityCapability>>>,
  detectBlockCapability: (blockName: string) =>
    ipcRenderer.invoke(DETECT_BLOCK_CAPABILITY_CHANNEL, blockName) as Promise<BlockEntityCapability | null>
}

contextBridge.exposeInMainWorld('frameLens', api)
