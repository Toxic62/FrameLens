import { homedir } from 'node:os'
import { basename, join, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { readdir, readFile, stat } from 'node:fs/promises'
import JSZip from 'jszip'
import type {
  AssetActivationResult,
  AssetScanResult,
  AssetSourceKind,
  AssetSourceSummary,
  BlockAssetRequest,
  BlockFaceTextures,
  ResolvedBlockAsset,
  ResolvedBlockAssetsResult
} from '@shared/assets'
import { createBlockAssetKey } from '@shared/assets'

interface AssetSource extends AssetSourceSummary {
  readonly archivePaths: readonly string[]
  readonly looseAssetRoots: readonly string[]
}

interface ArchiveCache {
  readonly zip: JSZip
  readonly entries: ReadonlySet<string>
}

type JsonRecord = Record<string, unknown>

const TEXTURE_FALLBACK_COLOR = '#9aa8b3'
const MAX_MODEL_DEPTH = 12
const archiveCache = new Map<string, Promise<ArchiveCache | null>>()
const jsonCache = new Map<string, Promise<JsonRecord | null>>()
const binaryCache = new Map<string, Promise<Buffer | null>>()

let discoveredSources: readonly AssetSource[] = []
let activeSource: AssetSource | null = null

export async function scanAssetSources(): Promise<AssetScanResult> {
  discoveredSources = await discoverAssetSources()

  if (!activeSource && discoveredSources.length > 0) {
    activeSource = discoveredSources[0] ?? null
  }

  if (activeSource && !discoveredSources.some((source) => source.id === activeSource?.id)) {
    activeSource = discoveredSources[0] ?? null
  }

  return {
    sources: discoveredSources.map(toSummary),
    activeSourceId: activeSource?.id ?? null
  }
}

export async function activateAssetSource(sourceId: string): Promise<AssetActivationResult> {
  if (discoveredSources.length === 0) {
    discoveredSources = await discoverAssetSources()
  }

  const source = discoveredSources.find((candidate) => candidate.id === sourceId)
  if (!source) {
    return {
      ok: false,
      source: null,
      message: 'Asset source is no longer available.'
    }
  }

  activeSource = source
  return {
    ok: true,
    source: toSummary(source)
  }
}

export async function activateAssetRootPath(rootPath: string): Promise<AssetActivationResult> {
  const source = await inspectAssetSource(rootPath)
  if (!source) {
    return {
      ok: false,
      source: null,
      message: 'No readable Minecraft assets were found in that folder.'
    }
  }

  const existing = discoveredSources.filter((candidate) => candidate.id !== source.id)
  discoveredSources = [source, ...existing]
  activeSource = source

  return {
    ok: true,
    source: toSummary(source)
  }
}

export async function resolveBlockAssets(blocks: readonly BlockAssetRequest[]): Promise<ResolvedBlockAssetsResult> {
  if (!activeSource && discoveredSources.length === 0) {
    await scanAssetSources()
  }

  const uniqueBlocks = new Map<string, BlockAssetRequest>()
  for (const block of blocks) {
    uniqueBlocks.set(createBlockAssetKey(block.blockName, block.properties), block)
  }

  const entries = await Promise.all(
    [...uniqueBlocks.entries()].map(async ([assetKey, block]) => [assetKey, await resolveBlock(assetKey, block)] as const)
  )

  return {
    activeSource: activeSource ? toSummary(activeSource) : null,
    assets: Object.fromEntries(entries)
  }
}

async function discoverAssetSources(): Promise<readonly AssetSource[]> {
  const candidates = uniquePaths([
    join(homedir(), 'Documents', 'astralis'),
    join(homedir(), 'Documents', 'Astralis'),
    join(homedir(), 'Library', 'Application Support', 'minecraft')
  ])

  const sources: AssetSource[] = []
  for (const candidate of candidates) {
    if (!(await pathExists(candidate))) {
      continue
    }

    const source = await inspectAssetSource(candidate)
    if (source) {
      sources.push(source)
    }
  }

  return sources.sort((a, b) => Number(b.name.toLowerCase().includes('astralis')) - Number(a.name.toLowerCase().includes('astralis')))
}

async function inspectAssetSource(rootPath: string): Promise<AssetSource | null> {
  const minecraftVersion = await readMinecraftVersion(rootPath)
  const archivePaths = await findAssetArchives(rootPath)
  const looseAssetRoots = await findLooseAssetRoots(rootPath)
  const hasVanillaJar = archivePaths.some((archivePath) => /[/\\]versions[/\\][^/\\]+[/\\][^/\\]+\.jar$/i.test(archivePath))

  if (archivePaths.length === 0 && looseAssetRoots.length === 0) {
    return null
  }

  return {
    id: pathToFileURL(rootPath).href,
    name: basename(rootPath) || rootPath,
    rootPath,
    kind: inferSourceKind(rootPath),
    minecraftVersion,
    archiveCount: archivePaths.length,
    looseAssetRootCount: looseAssetRoots.length,
    hasVanillaJar,
    archivePaths,
    looseAssetRoots
  }
}

async function readMinecraftVersion(rootPath: string): Promise<string | null> {
  const instanceJsonPath = join(rootPath, 'minecraftinstance.json')
  const instanceJson = await readJsonFile(instanceJsonPath)
  const directVersion = getString(instanceJson?.minecraftVersion)
  if (directVersion) {
    return directVersion
  }

  const versionsPath = join(rootPath, 'versions')
  const versionDirs = await safeReaddir(versionsPath)
  return versionDirs.find((entry) => entry.isDirectory())?.name ?? null
}

async function findAssetArchives(rootPath: string): Promise<readonly string[]> {
  const roots = [join(rootPath, 'versions'), join(rootPath, 'resourcepacks'), join(rootPath, 'mods')]
  const archivePaths: string[] = []

  for (const searchRoot of roots) {
    archivePaths.push(...(await findFiles(searchRoot, (filePath) => /\.(jar|zip)$/i.test(filePath), 2)))
  }

  return archivePaths.sort(prioritizeArchives)
}

async function findLooseAssetRoots(rootPath: string): Promise<readonly string[]> {
  const candidates = [
    rootPath,
    join(rootPath, 'kubejs'),
    join(rootPath, 'ldlib'),
    join(rootPath, 'Solace', 'src', 'main', 'resources')
  ]

  const roots: string[] = []
  for (const candidate of candidates) {
    if (await pathExists(join(candidate, 'assets'))) {
      roots.push(candidate)
    }
  }

  return uniquePaths(roots)
}

async function resolveBlock(assetKey: string, block: BlockAssetRequest): Promise<ResolvedBlockAsset> {
  if (!activeSource) {
    return fallbackAsset(assetKey, block, 'No asset source selected.')
  }

  const id = parseResourceId(block.blockName)
  const blockstate = await readAssetJson(activeSource, `assets/${id.namespace}/blockstates/${id.path}.json`)
  const modelReference = blockstate ? chooseModelReference(blockstate, block.properties) : `block/${id.path}`
  const resolvedModel = await resolveModel(activeSource, id.namespace, modelReference)
  const faceTextureIds = resolveFaceTextureIds(id.namespace, id.path, resolvedModel.textures)
  const faces = await loadFaceTextures(activeSource, faceTextureIds)

  if (!faces) {
    return fallbackAsset(assetKey, block, resolvedModel.warning ?? 'No supported block texture found.')
  }

  return {
    assetKey,
    blockName: block.blockName,
    properties: block.properties,
    status: 'textured-cube',
    sourceName: activeSource.name,
    faces,
    fallbackColor: getFallbackColor(assetKey)
  }
}

function chooseModelReference(blockstate: JsonRecord, properties: Readonly<Record<string, string>>): string {
  const variants = asRecord(blockstate.variants)
  if (variants) {
    const propertyKey = createVariantKey(properties)
    const exactVariant = asVariantRecord(variants[propertyKey])
    if (exactVariant) {
      return getString(exactVariant.model) ?? 'block/missing'
    }

    for (const [variantKey, value] of Object.entries(variants)) {
      if (variantKeyMatchesProperties(variantKey, properties)) {
        const matched = asVariantRecord(value)
        if (matched) {
          return getString(matched.model) ?? 'block/missing'
        }
      }
    }

    const defaultVariant = asVariantRecord(variants[''])
    if (defaultVariant) {
      return getString(defaultVariant.model) ?? 'block/missing'
    }

    const firstVariant = Object.values(variants)[0]
    const firstRecord = asVariantRecord(firstVariant)
    return getString(firstRecord?.model) ?? 'block/missing'
  }

  const multipart = Array.isArray(blockstate.multipart) ? blockstate.multipart : []
  const firstApply = asRecord(asRecord(multipart[0])?.apply)
  return getString(firstApply?.model) ?? 'block/missing'
}

async function resolveModel(
  source: AssetSource,
  defaultNamespace: string,
  modelReference: string,
  depth = 0
): Promise<{ readonly textures: Readonly<Record<string, string>>; readonly warning?: string }> {
  if (depth > MAX_MODEL_DEPTH) {
    return { textures: {}, warning: 'Model parent chain is too deep.' }
  }

  const id = parseResourceId(modelReference, defaultNamespace)
  const model = await readAssetJson(source, `assets/${id.namespace}/models/${id.path}.json`)
  if (!model) {
    return { textures: {}, warning: `Missing model ${id.namespace}:${id.path}.` }
  }

  const parentReference = getString(model.parent)
  const parentTextures = parentReference ? (await resolveModel(source, id.namespace, parentReference, depth + 1)).textures : {}
  const ownTextures = asStringRecord(model.textures)

  return {
    textures: {
      ...parentTextures,
      ...ownTextures
    }
  }
}

function resolveFaceTextureIds(
  namespace: string,
  blockPath: string,
  textures: Readonly<Record<string, string>>
): Record<keyof BlockFaceTextures, string> {
  const all = resolveTextureReference(textures.all, textures)
  const side = resolveTextureReference(textures.side, textures) ?? all
  const top = resolveTextureReference(textures.top, textures) ?? resolveTextureReference(textures.up, textures) ?? all ?? side
  const bottom =
    resolveTextureReference(textures.bottom, textures) ?? resolveTextureReference(textures.down, textures) ?? all ?? side ?? top
  const north = resolveTextureReference(textures.north, textures) ?? side ?? all ?? top
  const south = resolveTextureReference(textures.south, textures) ?? side ?? north
  const east = resolveTextureReference(textures.east, textures) ?? side ?? north
  const west = resolveTextureReference(textures.west, textures) ?? side ?? north
  const direct = `${namespace}:block/${blockPath}`

  return {
    up: toTextureId(top ?? direct, namespace),
    down: toTextureId(bottom ?? direct, namespace),
    north: toTextureId(north ?? direct, namespace),
    south: toTextureId(south ?? direct, namespace),
    east: toTextureId(east ?? direct, namespace),
    west: toTextureId(west ?? direct, namespace)
  }
}

function resolveTextureReference(value: string | undefined, textures: Readonly<Record<string, string>>): string | undefined {
  if (!value) {
    return undefined
  }

  if (!value.startsWith('#')) {
    return value
  }

  const key = value.slice(1)
  return resolveTextureReference(textures[key], textures)
}

async function loadFaceTextures(
  source: AssetSource,
  textureIds: Record<keyof BlockFaceTextures, string>
): Promise<BlockFaceTextures | null> {
  const entries = await Promise.all(
    (Object.entries(textureIds) as Array<[keyof BlockFaceTextures, string]>).map(async ([face, textureId]) => {
      const dataUrl = await loadTextureDataUrl(source, textureId)
      return [face, dataUrl] as const
    })
  )

  if (entries.some(([, dataUrl]) => !dataUrl)) {
    return null
  }

  return Object.fromEntries(entries) as unknown as BlockFaceTextures
}

async function loadTextureDataUrl(source: AssetSource, textureId: string): Promise<string | null> {
  const id = parseResourceId(textureId)
  const assetPath = `assets/${id.namespace}/textures/${id.path}.png`
  const data = await readAssetBinary(source, assetPath)
  return data ? `data:image/png;base64,${data.toString('base64')}` : null
}

async function readAssetJson(source: AssetSource, assetPath: string): Promise<JsonRecord | null> {
  const key = `${source.id}:json:${assetPath}`
  if (!jsonCache.has(key)) {
    jsonCache.set(
      key,
      readAssetBinary(source, assetPath).then((data) => {
        if (!data) {
          return null
        }

        try {
          return JSON.parse(data.toString('utf8')) as JsonRecord
        } catch {
          return null
        }
      })
    )
  }

  return jsonCache.get(key) ?? null
}

async function readAssetBinary(source: AssetSource, assetPath: string): Promise<Buffer | null> {
  const key = `${source.id}:binary:${assetPath}`
  if (!binaryCache.has(key)) {
    binaryCache.set(key, readAssetBinaryUncached(source, assetPath))
  }

  return binaryCache.get(key) ?? null
}

async function readAssetBinaryUncached(source: AssetSource, assetPath: string): Promise<Buffer | null> {
  for (const root of source.looseAssetRoots) {
    const filePath = join(root, ...assetPath.split('/'))
    if (await pathExists(filePath)) {
      return readFile(filePath)
    }
  }

  for (const archivePath of orderArchivesForAsset(source.archivePaths, assetPath)) {
    const archive = await loadArchive(archivePath)
    if (!archive?.entries.has(assetPath)) {
      continue
    }

    const entry = archive.zip.file(assetPath)
    return entry ? Buffer.from(await entry.async('uint8array')) : null
  }

  return null
}

function orderArchivesForAsset(archivePaths: readonly string[], assetPath: string): readonly string[] {
  const namespace = assetPath.split('/')[1]?.toLowerCase()
  if (!namespace) {
    return archivePaths
  }

  return [...archivePaths].sort((a, b) => archiveNamespaceScore(a, namespace) - archiveNamespaceScore(b, namespace))
}

function archiveNamespaceScore(archivePath: string, namespace: string): number {
  const name = basename(archivePath).toLowerCase()
  if (name.includes(namespace)) return 0
  if (archivePath.includes(`${sep}resourcepacks${sep}`)) return 1
  if (archivePath.includes(`${sep}versions${sep}`)) return 2
  return 3
}

async function loadArchive(archivePath: string): Promise<ArchiveCache | null> {
  if (!archiveCache.has(archivePath)) {
    archiveCache.set(
      archivePath,
      readFile(archivePath)
        .then(async (data) => {
          const zip = await JSZip.loadAsync(data)
          return {
            zip,
            entries: new Set(Object.keys(zip.files).filter((entry) => entry.startsWith('assets/')))
          }
        })
        .catch(() => null)
    )
  }

  return archiveCache.get(archivePath) ?? null
}

function parseResourceId(value: string, defaultNamespace = 'minecraft'): { readonly namespace: string; readonly path: string } {
  const [namespace, ...pathParts] = value.split(':')
  if (pathParts.length === 0) {
    return { namespace: defaultNamespace, path: namespace ?? value }
  }

  return { namespace: namespace || defaultNamespace, path: pathParts.join(':') }
}

function toTextureId(value: string, defaultNamespace: string): string {
  return value.includes(':') ? value : `${defaultNamespace}:${value}`
}

function fallbackAsset(assetKey: string, block: BlockAssetRequest, warning: string): ResolvedBlockAsset {
  return {
    assetKey,
    blockName: block.blockName,
    properties: block.properties,
    status: 'fallback',
    sourceName: activeSource?.name ?? null,
    faces: null,
    fallbackColor: getFallbackColor(assetKey),
    warning
  }
}

function getFallbackColor(blockName: string): string {
  let hash = 0
  for (const char of blockName) {
    hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  }

  const hue = hash % 360
  return `hsl(${hue}, 46%, 58%)`
}

function toSummary(source: AssetSource): AssetSourceSummary {
  return {
    id: source.id,
    name: source.name,
    rootPath: source.rootPath,
    kind: source.kind,
    minecraftVersion: source.minecraftVersion,
    archiveCount: source.archiveCount,
    looseAssetRootCount: source.looseAssetRootCount,
    hasVanillaJar: source.hasVanillaJar
  }
}

function inferSourceKind(rootPath: string): AssetSourceKind {
  if (rootPath.split(sep).includes('minecraft')) {
    return 'minecraft'
  }

  if (rootPath.toLowerCase().includes('astralis')) {
    return 'instance'
  }

  return 'folder'
}

function prioritizeArchives(a: string, b: string): number {
  const score = (archivePath: string): number => {
    if (archivePath.includes(`${sep}resourcepacks${sep}`)) return 0
    if (archivePath.includes(`${sep}versions${sep}`)) return 1
    if (archivePath.includes(`${sep}mods${sep}`)) return 2
    return 3
  }

  return score(a) - score(b) || a.localeCompare(b)
}

async function findFiles(rootPath: string, predicate: (filePath: string) => boolean, maxDepth: number): Promise<string[]> {
  const entries = await safeReaddir(rootPath)
  if (entries.length === 0) {
    return []
  }

  const results: string[] = []
  for (const entry of entries) {
    const filePath = join(rootPath, entry.name)
    if (entry.isDirectory() && maxDepth > 0) {
      results.push(...(await findFiles(filePath, predicate, maxDepth - 1)))
      continue
    }

    if (entry.isFile() && predicate(filePath)) {
      results.push(filePath)
    }
  }

  return results
}

async function pathExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath)
    return true
  } catch {
    return false
  }
}

async function safeReaddir(rootPath: string) {
  try {
    return await readdir(rootPath, { withFileTypes: true })
  } catch {
    return []
  }
}

async function readJsonFile(filePath: string): Promise<JsonRecord | null> {
  try {
    return JSON.parse(await readFile(filePath, 'utf8')) as JsonRecord
  } catch {
    return null
  }
}

function asRecord(value: unknown): JsonRecord | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as JsonRecord
}

function asVariantRecord(value: unknown): JsonRecord | null {
  return Array.isArray(value) ? asRecord(value[0]) : asRecord(value)
}

function createVariantKey(properties: Readonly<Record<string, string>>): string {
  return Object.entries(properties)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => `${key}=${value}`)
    .join(',')
}

function variantKeyMatchesProperties(variantKey: string, properties: Readonly<Record<string, string>>): boolean {
  if (variantKey.length === 0) {
    return false
  }

  return variantKey.split(',').every((entry) => {
    const [key, value] = entry.split('=')
    return key !== undefined && value !== undefined && properties[key] === value
  })
}

function asStringRecord(value: unknown): Record<string, string> {
  const record = asRecord(value)
  if (!record) {
    return {}
  }

  return Object.fromEntries(Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === 'string'))
}

function getString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)]
}
