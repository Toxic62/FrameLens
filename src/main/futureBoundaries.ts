export interface InstanceScanner {
  scanInstances(): Promise<readonly unknown[]>
}

export interface AssetProvider {
  getAsset(path: string): Promise<Uint8Array | null>
}

export interface ModelResolver {
  resolveModel(blockName: string): Promise<unknown | null>
}

export interface TextureResolver {
  resolveTexture(textureName: string): Promise<unknown | null>
}

export interface StructureExporter<TStructure> {
  exportStructure(structure: TStructure): Promise<Uint8Array>
}
