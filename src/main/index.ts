import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
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
import type { ExportStructureResult, LoadedStructure, OpenStructureResult } from '@shared/structure'
import { loadStructureFile, toOpenStructureError } from './structure/structureLoader'
import { exportMinecraftStructure } from './structure/structureExporter'
import {
  activateAssetRootPath,
  activateAssetSource,
  applyLearnedBlockCapabilities,
  detectBlockCapability,
  learnBlockCapabilitiesFromStructure,
  listBlockAssetIds,
  listDetectedBlockCapabilities,
  listItemAssetIds,
  resolveBlockAssets,
  scanAssetSources,
  setLearnedCapabilityStorePath,
  setVanillaCacheRoot
} from './assets/assetService'
import type { AssetActivationResult, BlockAssetRequest } from '@shared/assets'

let currentStructure: LoadedStructure | null = null
let currentFilePath: string | null = null
let hasUnsavedChanges = false
let closeConfirmed = false

function createWindow(): void {
  closeConfirmed = false

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

  mainWindow.on('close', (event) => {
    if (closeConfirmed || !hasUnsavedChanges || currentStructure === null) {
      return
    }

    event.preventDefault()
    void confirmSaveBeforeQuit(mainWindow)
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
    const parsedStructure = await loadStructureFile(filePath, data)
    await learnBlockCapabilitiesFromStructure(parsedStructure)
    const structure = await applyLearnedBlockCapabilities(parsedStructure)
    currentFilePath = filePath
    currentStructure = structure
    hasUnsavedChanges = false
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
    await learnBlockCapabilitiesFromStructure(structure)
    currentFilePath = result.filePath
    currentStructure = structure
    hasUnsavedChanges = false
    return { ok: true, filePath: result.filePath }
  } catch (error) {
    return {
      ok: false,
      reason: 'io-error',
      message: error instanceof Error ? error.message : 'Unable to export the structure file.'
    }
  }
}

function updateCurrentStructure(
  _: Electron.IpcMainEvent,
  structure: LoadedStructure,
  dirty: boolean
): void {
  currentStructure = structure
  hasUnsavedChanges = dirty
  void learnBlockCapabilitiesFromStructure(structure)
}

async function confirmSaveBeforeQuit(window: BrowserWindow): Promise<void> {
  const result = await dialog.showMessageBox(window, {
    type: 'question',
    buttons: ['Save', "Don't Save", 'Cancel'],
    defaultId: 0,
    cancelId: 2,
    title: 'Save changes before quitting?',
    message: 'Save changes before quitting FrameLens?',
    detail: 'Your structure has unsaved changes.'
  })

  if (result.response === 2) {
    return
  }

  if (result.response === 0) {
    const saved = await saveCurrentStructure(window)
    if (!saved) {
      return
    }
  }

  hasUnsavedChanges = false
  closeConfirmed = true
  window.close()
}

async function saveCurrentStructure(window: BrowserWindow): Promise<boolean> {
  if (currentStructure === null) {
    return true
  }

  const filePath = currentFilePath ?? await chooseSaveFilePath(window, currentStructure)
  if (!filePath) {
    return false
  }

  try {
    const data = exportMinecraftStructure(currentStructure)
    await writeFile(filePath, data)
    await learnBlockCapabilitiesFromStructure(currentStructure)
    currentFilePath = filePath
    hasUnsavedChanges = false
    return true
  } catch (error) {
    await dialog.showMessageBox(window, {
      type: 'error',
      title: 'Save failed',
      message: 'Unable to save the structure file.',
      detail: error instanceof Error ? error.message : 'An unknown error occurred.'
    })
    return false
  }
}

async function chooseSaveFilePath(window: BrowserWindow, structure: LoadedStructure): Promise<string | null> {
  const defaultName = structure.metadata.fileName.toLowerCase().endsWith('.nbt')
    ? structure.metadata.fileName
    : `${structure.metadata.fileName || 'structure'}.nbt`
  const result = await dialog.showSaveDialog(window, {
    title: 'Save Minecraft structure',
    defaultPath: defaultName,
    filters: [{ name: 'Minecraft structure NBT', extensions: ['nbt'] }]
  })

  return result.canceled ? null : result.filePath ?? null
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
  setLearnedCapabilityStorePath(join(app.getPath('userData'), 'learned-block-capabilities.json'))

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
  ipcMain.handle(LIST_BLOCK_ASSET_IDS_CHANNEL, listBlockAssetIds)
  ipcMain.handle(LIST_ITEM_ASSET_IDS_CHANNEL, listItemAssetIds)
  ipcMain.handle(LIST_DETECTED_BLOCK_CAPABILITIES_CHANNEL, listDetectedBlockCapabilities)
  ipcMain.handle(DETECT_BLOCK_CAPABILITY_CHANNEL, (_, blockName: string) => detectBlockCapability(blockName))
  ipcMain.on(UPDATE_CURRENT_STRUCTURE_CHANNEL, updateCurrentStructure)
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
