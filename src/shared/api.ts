import type { OpenStructureResult } from './structure'

export interface FrameLensApi {
  openStructureFile(): Promise<OpenStructureResult>
}
