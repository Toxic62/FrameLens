import type { LoadedStructure, OpenStructureResult } from './structure'

export interface FrameLensApi {
  openStructureFile(): Promise<OpenStructureResult>
  getCurrentStructure(): Promise<LoadedStructure | null>
}
