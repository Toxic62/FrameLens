import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { electronApp, is, optimizer } from '@electron-toolkit/utils'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { OPEN_STRUCTURE_CHANNEL } from '@shared/ipc'
import type { OpenStructureResult } from '@shared/structure'
import { loadStructureFile, toOpenStructureError } from './structure/structureLoader'

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
    return { ok: true, structure }
  } catch (error) {
    return toOpenStructureError(error)
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.framelens.app')

  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  ipcMain.handle(OPEN_STRUCTURE_CHANNEL, openStructureFile)
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
