import { contextBridge, ipcRenderer } from 'electron'
import type { FrameLensApi } from '@shared/api'
import { GET_CURRENT_STRUCTURE_CHANNEL, OPEN_STRUCTURE_CHANNEL } from '@shared/ipc'
import type { LoadedStructure, OpenStructureResult } from '@shared/structure'

const api: FrameLensApi = {
  openStructureFile: () => ipcRenderer.invoke(OPEN_STRUCTURE_CHANNEL) as Promise<OpenStructureResult>,
  getCurrentStructure: () => ipcRenderer.invoke(GET_CURRENT_STRUCTURE_CHANNEL) as Promise<LoadedStructure | null>
}

contextBridge.exposeInMainWorld('frameLens', api)
