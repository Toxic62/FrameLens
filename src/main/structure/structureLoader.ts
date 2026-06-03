import { basename } from 'node:path'
import { parseMinecraftStructure, StructureParseError } from './minecraftStructureParser'
import type { LoadedStructure, OpenStructureResult } from '@shared/structure'

export async function loadStructureFile(filePath: string, data: Buffer): Promise<LoadedStructure> {
  return parseMinecraftStructure({
    fileName: basename(filePath),
    byteSize: data.byteLength,
    data
  })
}

export function toOpenStructureError(error: unknown): OpenStructureResult {
  if (error instanceof StructureParseError) {
    return {
      ok: false,
      reason: 'parse-error',
      message: error.message
    }
  }

  return {
    ok: false,
    reason: 'io-error',
    message: error instanceof Error ? error.message : 'Unable to open the structure file.'
  }
}
