import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import {
  ACTIVATE_ASSET_SOURCE_CHANNEL,
  CHOOSE_INSTANCE_FOLDER_CHANNEL,
  EXPORT_STRUCTURE_CHANNEL,
  GET_CURRENT_STRUCTURE_CHANNEL,
  OPEN_STRUCTURE_CHANNEL,
  RESOLVE_BLOCK_ASSETS_CHANNEL,
  SCAN_ASSET_SOURCES_CHANNEL
} from '@shared/ipc'
import type { ExportStructureResult, LoadedStructure, OpenStructureResult } from '@shared/structure'
import { loadStructureFile, toOpenStructureError } from './structure/structureLoader'
import { exportMinecraftStructure } from './structure/structureExporter'
import { activateAssetRootPath, activateAssetSource, resolveBlockAssets, scanAssetSources, setVanillaCacheRoot } from './assets/assetService'
import type { AssetActivationResult, BlockAssetRequest } from '@shared/assets'

let currentStructure: LoadedStructure | null = null
let currentFilePath: string | null = null

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: 'FrameLens',
    backgroundColor: '#111417',
    webPreferences: {
      preload: join(__dirname, '../preload/index.mjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    void shell.openExternal(details.url)
    return { action: 'deny' }
  })

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

async function openStructureFile(): Promise<OpenStructureResult> {
  const result = await dialog.showOpenDialog({
    title: 'Open Minecraft structure',
    properties: ['openFile'],
    filters: [{ name: 'Minecraft structure NBT', extensions: ['nbt'] }]
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, reason: 'cancelled' }
  }

  const filePath = result.filePaths[0]
  if (filePath === undefined || !filePath.toLowerCase().endsWith('.nbt')) {
    return {
      ok: false,
      reason: 'unsupported-format',
      message: 'Choose a Minecraft structure file with the .nbt extension.'
    }
  }

  try {
    const data = await readFile(filePath)
    const structure = await loadStructureFile(filePath, data)
    currentFilePath = filePath
    currentStructure = structure
    return { ok: true, structure }
  } catch (error) {
    return toOpenStructureError(error)
  }
}

function getCurrentStructure(): LoadedStructure | null {
  return currentStructure
}

async function exportStructureFile(_: Electron.IpcMainInvokeEvent, structure: LoadedStructure): Promise<ExportStructureResult> {
  const defaultName = structure.metadata.fileName.toLowerCase().endsWith('.nbt')
    ? structure.metadata.fileName
    : `${structure.metadata.fileName || 'structure'}.nbt`
  const result = await dialog.showSaveDialog({
    title: 'Export Minecraft structure',
    defaultPath: currentFilePath ?? defaultName,
    filters: [{ name: 'Minecraft structure NBT', extensions: ['nbt'] }]
  })

  if (result.canceled || !result.filePath) {
    return { ok: false, reason: 'cancelled' }
  }

  try {
    const data = exportMinecraftStructure(structure)
    await writeFile(result.filePath, data)
    currentFilePath = result.filePath
    currentStructure = structure
    return { ok: true, filePath: result.filePath }
  } catch (error) {
    return {
      ok: false,
      reason: 'io-error',
      message: error instanceof Error ? error.message : 'Unable to export the structure file.'
    }
  }
}

async function chooseInstanceFolder(): Promise<AssetActivationResult> {
  const result = await dialog.showOpenDialog({
    title: 'Choose Minecraft instance folder',
    properties: ['openDirectory']
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { ok: false, source: null, cancelled: true }
  }

  const folderPath = result.filePaths[0]
  return folderPath
    ? activateAssetRootPath(folderPath)
    : { ok: false, source: null, cancelled: true }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.framelens.app')
  setVanillaCacheRoot(join(app.getPath('userData'), 'vanilla-assets'))

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle(OPEN_STRUCTURE_CHANNEL, openStructureFile)
  ipcMain.handle(GET_CURRENT_STRUCTURE_CHANNEL, getCurrentStructure)
  ipcMain.handle(EXPORT_STRUCTURE_CHANNEL, exportStructureFile)
  ipcMain.handle(SCAN_ASSET_SOURCES_CHANNEL, scanAssetSources)
  ipcMain.handle(CHOOSE_INSTANCE_FOLDER_CHANNEL, chooseInstanceFolder)
  ipcMain.handle(ACTIVATE_ASSET_SOURCE_CHANNEL, (_, sourceId: string) => activateAssetSource(sourceId))
  ipcMain.handle(RESOLVE_BLOCK_ASSETS_CHANNEL, (_, blocks: readonly BlockAssetRequest[]) => resolveBlockAssets(blocks))
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow()
    }
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
