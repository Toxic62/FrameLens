import { contextBridge, ipcRenderer } from 'electron'
import type { FrameLensApi } from '@shared/api'
import { OPEN_STRUCTURE_CHANNEL } from '@shared/ipc'
import type { OpenStructureResult } from '@shared/structure'

const api: FrameLensApi = {
  openStructureFile: () => ipcRenderer.invoke(OPEN_STRUCTURE_CHANNEL) as Promise<OpenStructureResult>
}

contextBridge.exposeInMainWorld('frameLens', api)
