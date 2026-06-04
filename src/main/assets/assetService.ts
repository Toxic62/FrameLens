import { homedir } from 'node:os'
import { basename, dirname, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import JSZip from 'jszip'
import type {
  AssetActivationResult,
  AssetScanResult,
  AssetSourceKind,
  AssetSourceSummary,
  BlockModelElement,
  BlockAssetRequest,
  BlockFaceTextures,
  ModelCoordinate,
  ModelUv,
  ResolvedBlockAsset,
  ResolvedBlockAssetsResult,
  VanillaAssetStatus
} from '@shared/assets'
import { createBlockAssetKey } from '@shared/assets'
import { getKnownBlockEntityCapability, type BlockEntityCapability } from '@shared/blockCapabilities'
import type { BlockEntitySummary, LoadedStructure, RenderableBlock } from '@shared/structure'

interface AssetSource extends AssetSourceSummary {
  readonly archivePaths: readonly string[]
  readonly looseAssetRoots: readonly string[]
}

interface ArchiveCache {
  readonly zip: JSZip
  readonly entries: ReadonlySet<string>
}

interface CapabilityHintIndex {
  readonly langKeys: ReadonlySet<string>
  readonly classHintsByNamespace: ReadonlyMap<string, readonly ClassCapabilityHint[]>
}

interface ClassCapabilityHint {
  readonly entry: string
  readonly normalizedEntry: string
  readonly isContainer: boolean
}

type JsonRecord = Record<string, unknown>
type FaceName = keyof BlockFaceTextures
type ModelElementDefinition = {
  readonly from: ModelCoordinate
  readonly to: ModelCoordinate
  readonly faceTextureReferences: Readonly<Partial<Record<FaceName, string>>>
  readonly faceUvs: Readonly<Partial<Record<FaceName, ModelUv>>>
}

const MAX_MODEL_DEPTH = 12
const ASSET_SCAN_CONCURRENCY = 4
const VERSION_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const archiveCache = new Map<string, Promise<ArchiveCache | null>>()
const jsonCache = new Map<string, Promise<JsonRecord | null>>()
const binaryCache = new Map<string, Promise<Buffer | null>>()
const blockIdCache = new Map<string, Promise<readonly string[]>>()
const itemIdCache = new Map<string, Promise<readonly string[]>>()
const blockCapabilityCache = new Map<string, Promise<Readonly<Record<string, BlockEntityCapability>>>>()
const capabilityHintCache = new Map<string, Promise<CapabilityHintIndex>>()

let discoveredSources: readonly AssetSource[] = []
let activeSource: AssetSource | null = null
let vanillaCacheRoot = join(homedir(), '.framelens', 'vanilla-assets')
let learnedCapabilityStorePath = join(homedir(), '.framelens', 'learned-block-capabilities.json')
let learnedCapabilityStoreCache: Promise<Record<string, BlockEntityCapability>> | null = null
let downloadClient: DownloadClient = createFetchDownloadClient()

interface VanillaAssetResolution {
  readonly status: VanillaAssetStatus
  readonly jarPath: string | null
  readonly message?: string
}

interface ResolvedModel {
  readonly textures: Readonly<Record<string, string>>
  readonly faceTextureReferences: Readonly<Partial<Record<FaceName, string>>>
  readonly elements: readonly ModelElementDefinition[]
  readonly warning?: string
}

interface ModelReference {
  readonly model: string
  readonly yRotation: number
}

export interface DownloadClient {
  getJson(url: string): Promise<JsonRecord>
  getBuffer(url: string): Promise<Buffer>
}

export function setVanillaCacheRoot(rootPath: string): void {
  vanillaCacheRoot = rootPath
}

export function setLearnedCapabilityStorePath(filePath: string): void {
  learnedCapabilityStorePath = filePath
  learnedCapabilityStoreCache = null
}

export function setDownloadClientForTests(client: DownloadClient): void {
  downloadClient = client
}

export async function scanAssetSources(): Promise<AssetScanResult> {
  return {
    sources: discoveredSources.map(toSummary),
    activeSourceId: activeSource?.id ?? null
  }
}

export async function activateAssetSource(sourceId: string): Promise<AssetActivationResult> {
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

export async function listBlockAssetIds(): Promise<readonly string[]> {
  if (!activeSource) {
    return []
  }

  return getCachedBlockAssetIds(activeSource)
}

export async function listItemAssetIds(): Promise<readonly string[]> {
  if (!activeSource) {
    return []
  }

  return getCachedItemAssetIds(activeSource)
}

function getCachedBlockAssetIds(source: AssetSource): Promise<readonly string[]> {
  if (!blockIdCache.has(source.id)) {
    blockIdCache.set(source.id, listBlockAssetIdsUncached(source))
  }

  return blockIdCache.get(source.id) ?? Promise.resolve([])
}

async function listBlockAssetIdsUncached(source: AssetSource): Promise<readonly string[]> {
  const blockIds = new Set<string>()
  await Promise.all([collectLooseBlockIds(source, blockIds), collectArchiveBlockIds(source, blockIds)])

  return [...blockIds].sort((left, right) => left.localeCompare(right))
}

function getCachedItemAssetIds(source: AssetSource): Promise<readonly string[]> {
  if (!itemIdCache.has(source.id)) {
    itemIdCache.set(source.id, listItemAssetIdsUncached(source))
  }

  return itemIdCache.get(source.id) ?? Promise.resolve([])
}

async function listItemAssetIdsUncached(source: AssetSource): Promise<readonly string[]> {
  const itemIds = new Set<string>()
  await Promise.all([collectLooseItemIds(source, itemIds), collectArchiveItemIds(source, itemIds)])

  return [...itemIds].sort((left, right) => left.localeCompare(right))
}

export async function listDetectedBlockCapabilities(): Promise<Readonly<Record<string, BlockEntityCapability>>> {
  if (!activeSource) {
    return readLearnedCapabilities()
  }

  const source = activeSource
  if (!blockCapabilityCache.has(source.id)) {
    blockCapabilityCache.set(source.id, listDetectedBlockCapabilitiesUncached(source))
  }

  return blockCapabilityCache.get(source.id) ?? {}
}

export async function detectBlockCapability(blockName: string): Promise<BlockEntityCapability | null> {
  const normalized = normalizeBlockId(blockName)
  const knownCapability = getKnownBlockEntityCapability(normalized)
  if (knownCapability) {
    return knownCapability
  }

  const learnedCapability = (await readLearnedCapabilities())[normalized] ?? null
  const id = parseResourceId(normalized)
  const nameCapability = hasContainerNameHint(id.namespace, id.path)
    ? ({ kind: 'container', supportsLootTable: true } satisfies BlockEntityCapability)
    : null
  if (learnedCapability?.kind === 'container' || nameCapability?.kind === 'container') {
    return {
      kind: 'container',
      supportsLootTable: learnedCapability?.supportsLootTable ?? nameCapability?.supportsLootTable ?? true
    }
  }
  if (learnedCapability) {
    return learnedCapability
  }
  if (nameCapability) {
    return { kind: 'container', supportsLootTable: true }
  }

  if (!activeSource) {
    return null
  }

  const hints = await getCachedCapabilityHints(activeSource)
  return inferDetectedBlockCapability(normalized, hints)
}

export async function listLearnedBlockCapabilities(): Promise<Readonly<Record<string, BlockEntityCapability>>> {
  return readLearnedCapabilities()
}

export async function learnBlockCapabilitiesFromStructure(structure: LoadedStructure): Promise<void> {
  const current = await readLearnedCapabilities()
  const next: Record<string, BlockEntityCapability> = { ...current }
  let changed = false

  for (const block of structure.blocks) {
    const capability = inferCapabilityFromRenderableBlock(block)
    if (!capability) {
      continue
    }

    const normalized = normalizeBlockId(block.name)
    if (shouldReplaceLearnedCapability(next[normalized], capability)) {
      next[normalized] = capability
      changed = true
    }
  }

  if (changed) {
    await writeLearnedCapabilities(next)
  }
}

export async function applyLearnedBlockCapabilities(structure: LoadedStructure): Promise<LoadedStructure> {
  const learned = await readLearnedCapabilities()
  let changed = false
  const blocks = structure.blocks.map((block) => {
    const capability = learned[normalizeBlockId(block.name)]
    if (!capability || !block.blockEntity) {
      return block
    }

    const blockEntity = updateBlockEntityWithCapability(block.blockEntity, capability)
    if (blockEntity === block.blockEntity) {
      return block
    }

    changed = true
    return { ...block, blockEntity }
  })

  return changed ? { ...structure, blocks } : structure
}

async function listDetectedBlockCapabilitiesUncached(source: AssetSource): Promise<Readonly<Record<string, BlockEntityCapability>>> {
  const [blockIds, hints] = await Promise.all([getCachedBlockAssetIds(source), getCachedCapabilityHints(source)])
  const learned = await readLearnedCapabilities()
  const entries = blockIds.flatMap((blockId) => {
    const capability = inferDetectedBlockCapability(blockId, hints)
    return capability ? [[blockId, capability] as const] : []
  })

  return { ...Object.fromEntries(entries), ...learned }
}

async function inspectAssetSource(rootPath: string): Promise<AssetSource | null> {
  const minecraftVersion = await readMinecraftVersion(rootPath)
  const instanceArchivePaths = await findAssetArchives(rootPath)
  const looseAssetRoots = await findLooseAssetRoots(rootPath)
  const vanillaAssets = await ensureVanillaAssets(minecraftVersion)
  const archivePaths = uniquePaths(vanillaAssets.jarPath ? [...instanceArchivePaths, vanillaAssets.jarPath] : instanceArchivePaths)
  const hasVanillaJar =
    vanillaAssets.jarPath !== null || archivePaths.some((archivePath) => /[/\\]versions[/\\][^/\\]+[/\\][^/\\]+\.jar$/i.test(archivePath))

  if (archivePaths.length === 0 && looseAssetRoots.length === 0) {
    return null
  }

  const source: AssetSource = {
    id: pathToFileURL(rootPath).href,
    name: basename(rootPath) || rootPath,
    rootPath,
    kind: inferSourceKind(rootPath),
    minecraftVersion,
    archiveCount: archivePaths.length,
    looseAssetRootCount: looseAssetRoots.length,
    hasVanillaJar,
    vanillaStatus: vanillaAssets.status,
    archivePaths,
    looseAssetRoots
  }
  if (vanillaAssets.message) {
    return { ...source, vanillaMessage: vanillaAssets.message }
  }

  return source
}

async function readMinecraftVersion(rootPath: string): Promise<string | null> {
  const instanceJsonPath = join(rootPath, 'minecraftinstance.json')
  const instanceJson = await readJsonFile(instanceJsonPath)
  const directVersion = getString(instanceJson?.minecraftVersion)
  if (directVersion) {
    return directVersion
  }
  const nestedVersion = getString(asRecord(instanceJson?.baseModLoader)?.minecraftVersion)
  if (nestedVersion) {
    return nestedVersion
  }

  const configVersion = await readInstanceConfigVersion(join(rootPath, 'instance.cfg'))
  if (configVersion) {
    return configVersion
  }

  const versionsPath = join(rootPath, 'versions')
  const versionDirs = await safeReaddir(versionsPath)
  return versionDirs.find((entry) => entry.isDirectory())?.name ?? null
}

async function readInstanceConfigVersion(filePath: string): Promise<string | null> {
  try {
    const lines = (await readFile(filePath, 'utf8')).split(/\r?\n/)
    for (const line of lines) {
      const [key, value] = line.split('=')
      if ((key === 'IntendedVersion' || key === 'MinecraftVersion') && value) {
        return value.trim() || null
      }
    }
  } catch {
    return null
  }

  return null
}

async function ensureVanillaAssets(minecraftVersion: string | null): Promise<VanillaAssetResolution> {
  if (!minecraftVersion) {
    return {
      status: 'missing-version',
      jarPath: null,
      message: 'Minecraft version could not be detected.'
    }
  }

  const versionDirectory = join(vanillaCacheRoot, sanitizePathSegment(minecraftVersion))
  const jarPath = join(versionDirectory, `${sanitizePathSegment(minecraftVersion)}.jar`)
  if (await pathExists(jarPath)) {
    return { status: 'cached', jarPath }
  }

  try {
    await mkdir(versionDirectory, { recursive: true })
    const manifest = await downloadClient.getJson(VERSION_MANIFEST_URL)
    const versions = Array.isArray(manifest.versions) ? manifest.versions : []
    const versionEntry = versions.map(asRecord).find((entry) => getString(entry?.id) === minecraftVersion)
    const versionUrl = getString(versionEntry?.url)
    if (!versionUrl) {
      return {
        status: 'failed',
        jarPath: null,
        message: `Minecraft ${minecraftVersion} was not found in Mojang's version manifest.`
      }
    }

    const versionJson = await downloadClient.getJson(versionUrl)
    const clientUrl = getString(asRecord(asRecord(versionJson.downloads)?.client)?.url)
    if (!clientUrl) {
      return {
        status: 'failed',
        jarPath: null,
        message: `Minecraft ${minecraftVersion} does not expose a client download.`
      }
    }

    await writeFile(jarPath, await downloadClient.getBuffer(clientUrl))
    return { status: 'downloaded', jarPath }
  } catch (error) {
    return {
      status: 'failed',
      jarPath: null,
      message: error instanceof Error ? error.message : 'Vanilla asset download failed.'
    }
  }
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

async function collectLooseBlockIds(source: AssetSource, blockIds: Set<string>): Promise<void> {
  await mapWithConcurrency(source.looseAssetRoots, ASSET_SCAN_CONCURRENCY, async (root) => {
    const assetsRoot = join(root, 'assets')
    const namespaces = await safeReaddir(assetsRoot)
    await mapWithConcurrency(
      namespaces.filter((entry) => entry.isDirectory()),
      ASSET_SCAN_CONCURRENCY,
      async (namespaceEntry) => {
        const blockstatesRoot = join(assetsRoot, namespaceEntry.name, 'blockstates')
        const blockstateFiles = await findFiles(blockstatesRoot, (filePath) => filePath.endsWith('.json'), 12)
        for (const filePath of blockstateFiles) {
          const blockPath = relative(blockstatesRoot, filePath).replace(/\\/g, '/').replace(/\.json$/i, '')
          if (blockPath.length > 0) {
            blockIds.add(`${namespaceEntry.name}:${blockPath}`)
          }
        }
      }
    )
  })
}

async function collectArchiveBlockIds(source: AssetSource, blockIds: Set<string>): Promise<void> {
  await mapWithConcurrency(source.archivePaths, ASSET_SCAN_CONCURRENCY, async (archivePath) => {
    const archive = await loadArchive(archivePath)
    if (!archive) {
      return
    }

    for (const entry of archive.entries) {
      const match = /^assets\/([^/]+)\/blockstates\/(.+)\.json$/i.exec(entry)
      if (match?.[1] && match[2]) {
        blockIds.add(`${match[1]}:${match[2]}`)
      }
    }
  })
}

async function collectLooseItemIds(source: AssetSource, itemIds: Set<string>): Promise<void> {
  await mapWithConcurrency(source.looseAssetRoots, ASSET_SCAN_CONCURRENCY, async (root) => {
    const assetsRoot = join(root, 'assets')
    const namespaces = await safeReaddir(assetsRoot)
    await mapWithConcurrency(
      namespaces.filter((entry) => entry.isDirectory()),
      ASSET_SCAN_CONCURRENCY,
      async (namespaceEntry) => {
        const itemModelsRoot = join(assetsRoot, namespaceEntry.name, 'models', 'item')
        const itemModelFiles = await findFiles(itemModelsRoot, (filePath) => filePath.endsWith('.json'), 12)
        for (const filePath of itemModelFiles) {
          const itemPath = relative(itemModelsRoot, filePath).replace(/\\/g, '/').replace(/\.json$/i, '')
          if (itemPath.length > 0) {
            itemIds.add(`${namespaceEntry.name}:${itemPath}`)
          }
        }
      }
    )
  })
}

async function collectArchiveItemIds(source: AssetSource, itemIds: Set<string>): Promise<void> {
  await mapWithConcurrency(source.archivePaths, ASSET_SCAN_CONCURRENCY, async (archivePath) => {
    const archive = await loadArchive(archivePath)
    if (!archive) {
      return
    }

    for (const entry of archive.entries) {
      const match = /^assets\/([^/]+)\/models\/item\/(.+)\.json$/i.exec(entry)
      if (match?.[1] && match[2]) {
        itemIds.add(`${match[1]}:${match[2]}`)
      }
    }
  })
}

async function collectCapabilityHints(source: AssetSource): Promise<CapabilityHintIndex> {
  const langKeys = new Set<string>()
  const classHintsByNamespace = new Map<string, ClassCapabilityHint[]>()

  await Promise.all([
    collectLooseLangKeys(source, langKeys),
    collectArchiveCapabilityHints(source, langKeys, classHintsByNamespace)
  ])

  return { langKeys, classHintsByNamespace }
}

function getCachedCapabilityHints(source: AssetSource): Promise<CapabilityHintIndex> {
  if (!capabilityHintCache.has(source.id)) {
    capabilityHintCache.set(source.id, collectCapabilityHints(source))
  }

  return capabilityHintCache.get(source.id) ?? Promise.resolve({ langKeys: new Set(), classHintsByNamespace: new Map() })
}

async function readLearnedCapabilities(): Promise<Record<string, BlockEntityCapability>> {
  if (!learnedCapabilityStoreCache) {
    learnedCapabilityStoreCache = readLearnedCapabilitiesUncached()
  }

  return learnedCapabilityStoreCache
}

async function readLearnedCapabilitiesUncached(): Promise<Record<string, BlockEntityCapability>> {
  const json = await readJsonFile(learnedCapabilityStorePath)
  const learned: Record<string, BlockEntityCapability> = {}
  for (const [blockName, value] of Object.entries(json ?? {})) {
    const capability = asBlockEntityCapability(value)
    if (capability) {
      learned[normalizeBlockId(blockName)] = capability
    }
  }

  return learned
}

async function writeLearnedCapabilities(capabilities: Record<string, BlockEntityCapability>): Promise<void> {
  await mkdir(dirname(learnedCapabilityStorePath), { recursive: true })
  const sorted = Object.fromEntries(Object.entries(capabilities).sort(([left], [right]) => left.localeCompare(right)))
  await writeFile(learnedCapabilityStorePath, `${JSON.stringify(sorted, null, 2)}\n`)
  learnedCapabilityStoreCache = Promise.resolve(sorted)
  blockCapabilityCache.clear()
}

function asBlockEntityCapability(value: unknown): BlockEntityCapability | null {
  const record = asRecord(value)
  if (!record) {
    return null
  }

  const kind = record.kind
  const supportsLootTable = record.supportsLootTable
  if (
    (kind === 'container' || kind === 'generic' || kind === 'jigsaw') &&
    typeof supportsLootTable === 'boolean'
  ) {
    return { kind, supportsLootTable }
  }

  return null
}

function inferCapabilityFromRenderableBlock(block: RenderableBlock): BlockEntityCapability | null {
  if (!block.blockEntity) {
    return null
  }

  if (block.blockEntity.kind === 'container') {
    return {
      kind: 'container',
      supportsLootTable: block.blockEntity.containerMode === 'lootTable' || block.blockEntity.fields.LootTable !== undefined
    }
  }

  if (block.blockEntity.kind === 'jigsaw') {
    return { kind: 'jigsaw', supportsLootTable: false }
  }

  return { kind: 'generic', supportsLootTable: false }
}

function shouldReplaceLearnedCapability(
  current: BlockEntityCapability | undefined,
  next: BlockEntityCapability
): boolean {
  if (!current) {
    return true
  }

  if (current.kind !== 'container' && next.kind === 'container') {
    return true
  }

  return current.kind === 'container' && next.kind === 'container' && !current.supportsLootTable && next.supportsLootTable
}

function updateBlockEntityWithCapability(
  blockEntity: BlockEntitySummary,
  capability: BlockEntityCapability
): BlockEntitySummary {
  if (capability.kind === blockEntity.kind) {
    return blockEntity
  }

  if (capability.kind === 'container') {
    const containerMode = capability.supportsLootTable && blockEntity.fields.LootTable ? 'lootTable' : 'items'
    return {
      ...blockEntity,
      kind: 'container',
      containerMode,
      ...(containerMode === 'items' ? { items: blockEntity.items ?? [] } : {})
    }
  }

  return blockEntity
}

async function collectLooseLangKeys(source: AssetSource, langKeys: Set<string>): Promise<void> {
  await mapWithConcurrency(source.looseAssetRoots, ASSET_SCAN_CONCURRENCY, async (root) => {
    const assetsRoot = join(root, 'assets')
    const namespaces = await safeReaddir(assetsRoot)
    await mapWithConcurrency(
      namespaces.filter((entry) => entry.isDirectory()),
      ASSET_SCAN_CONCURRENCY,
      async (namespaceEntry) => {
        const langRoot = join(assetsRoot, namespaceEntry.name, 'lang')
        const langFiles = await findFiles(langRoot, (filePath) => filePath.endsWith('.json'), 2)
        await mapWithConcurrency(langFiles, ASSET_SCAN_CONCURRENCY, (filePath) => addLangKeysFromFile(filePath, langKeys))
      }
    )
  })
}

async function collectArchiveCapabilityHints(
  source: AssetSource,
  langKeys: Set<string>,
  classHintsByNamespace: Map<string, ClassCapabilityHint[]>
): Promise<void> {
  await mapWithConcurrency(source.archivePaths, ASSET_SCAN_CONCURRENCY, async (archivePath) => {
    const archive = await loadArchive(archivePath)
    if (!archive) {
      return
    }

    await mapWithConcurrency(
      [...archive.entries].filter((entry) => /^assets\/[^/]+\/lang\/.+\.json$/i.test(entry)),
      ASSET_SCAN_CONCURRENCY,
      (entry) => addLangKeysFromArchiveEntry(archive, entry, langKeys)
    )
    collectArchiveBlockEntityClassHints(archive, classHintsByNamespace)
  })
}

function collectArchiveBlockEntityClassHints(archive: ArchiveCache, classHintsByNamespace: Map<string, ClassCapabilityHint[]>): void {
  const namespaces = [...new Set([...archive.entries].flatMap((entry) => /^assets\/([^/]+)\//i.exec(entry)?.[1] ?? []))]
  const entries = [...archive.zip.file(/(?:blockentity|tileentity).*\.class$/i)].map((entry) => entry.name)
  for (const entry of entries) {
    const normalizedEntry = normalizeSearchText(entry)
    const namespace = findNamespaceInClassEntry(normalizedEntry, namespaces)
    if (!namespace) {
      continue
    }

    const hints = classHintsByNamespace.get(namespace) ?? []
    hints.push({
      entry,
      normalizedEntry,
      isContainer: hasContainerClassHint(entry)
    })
    classHintsByNamespace.set(namespace, hints)
  }
}

async function addLangKeysFromFile(filePath: string, langKeys: Set<string>): Promise<void> {
  const lang = await readJsonFile(filePath)
  if (!lang) {
    return
  }

  for (const key of Object.keys(lang)) {
    langKeys.add(key.toLowerCase())
  }
}

async function addLangKeysFromArchiveEntry(archive: ArchiveCache, entryPath: string, langKeys: Set<string>): Promise<void> {
  const entry = archive.zip.file(entryPath)
  if (!entry) {
    return
  }

  try {
    const lang = JSON.parse(await entry.async('string')) as JsonRecord
    for (const key of Object.keys(lang)) {
      langKeys.add(key.toLowerCase())
    }
  } catch {
    return
  }
}

function inferDetectedBlockCapability(blockId: string, hints: CapabilityHintIndex): BlockEntityCapability | null {
  const knownCapability = getKnownBlockEntityCapability(blockId)
  if (knownCapability) {
    return knownCapability
  }

  const id = parseResourceId(blockId)
  if (hasContainerTranslationKey(id.namespace, id.path, hints.langKeys)) {
    return { kind: 'container', supportsLootTable: true }
  }

  const classMatches = findMatchingBlockEntityClassEntries(id.namespace, id.path, hints.classHintsByNamespace)
  if (classMatches.some((match) => match.isContainer)) {
    return { kind: 'container', supportsLootTable: true }
  }
  if (classMatches.length > 0) {
    return { kind: 'generic', supportsLootTable: false }
  }

  if (hasContainerNameHint(id.namespace, id.path)) {
    return { kind: 'container', supportsLootTable: true }
  }

  return null
}

function hasContainerTranslationKey(namespace: string, blockPath: string, langKeys: ReadonlySet<string>): boolean {
  const compactPath = blockPath.replace(/\//g, '.')
  return [
    `container.${namespace}.${blockPath}`,
    `container.${namespace}.${compactPath}`,
    `screen.${namespace}.${blockPath}`,
    `screen.${namespace}.${compactPath}`,
    `gui.${namespace}.${blockPath}`,
    `gui.${namespace}.${compactPath}`
  ].some((key) => langKeys.has(key.toLowerCase()))
}

function findMatchingBlockEntityClassEntries(
  namespace: string,
  blockPath: string,
  classHintsByNamespace: ReadonlyMap<string, readonly ClassCapabilityHint[]>
): readonly ClassCapabilityHint[] {
  const tokens = blockPath.split(/[^a-zA-Z0-9]+/).filter((token) => token.length > 0)
  if (tokens.length === 0) {
    return []
  }

  const hints = classHintsByNamespace.get(namespace) ?? []
  return hints.filter((hint) => tokens.every((token) => hint.normalizedEntry.includes(normalizeSearchText(token))))
}

function hasContainerClassHint(classEntry: string): boolean {
  return /(?:chest|barrel|crate|container|inventory|storage|drawer|cabinet|locker|safe|box|shelf|vault)/i.test(classEntry)
}

function hasContainerNameHint(namespace: string, blockPath: string): boolean {
  const tokens = `${namespace}/${blockPath}`.split(/[^a-zA-Z0-9]+/).map((token) => token.toLowerCase())
  return tokens.some((token) =>
    ['chest', 'barrel', 'crate', 'container', 'inventory', 'storage', 'drawer', 'cabinet', 'locker', 'safe', 'box', 'vault'].includes(token)
  )
}

function normalizeSearchText(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function findNamespaceInClassEntry(normalizedClassEntry: string, namespaces: readonly string[]): string | null {
  for (const namespace of namespaces) {
    if (normalizedClassEntry.includes(normalizeSearchText(namespace))) {
      return namespace
    }
  }

  return null
}

async function resolveBlock(assetKey: string, block: BlockAssetRequest): Promise<ResolvedBlockAsset> {
  if (!activeSource) {
    return fallbackAsset(assetKey, block, 'No asset source selected.')
  }

  const id = parseResourceId(block.blockName)
  const blockstate = await readAssetJson(activeSource, `assets/${id.namespace}/blockstates/${id.path}.json`)
  const modelReference = blockstate ? chooseModelReference(blockstate, block.properties) : { model: `block/${id.path}`, yRotation: 0 }
  const resolvedModel = await resolveModel(activeSource, id.namespace, modelReference.model)
  const faceTextureIds = resolveFaceTextureIds(id.namespace, id.path, resolvedModel)
  const faces = await loadFaceTextures(activeSource, faceTextureIds)
  const elements = await resolveModelElements(activeSource, id.namespace, resolvedModel, faceTextureIds, modelReference.yRotation)

  if (!faces || !elements) {
    const specialAsset = await resolveSpecialBlockAsset(assetKey, block)
    if (specialAsset) {
      return specialAsset
    }

    return fallbackAsset(assetKey, block, resolvedModel.warning ?? 'No supported block texture found.')
  }

  return {
    assetKey,
    blockName: block.blockName,
    properties: block.properties,
    status: 'textured-cube',
    sourceName: activeSource.name,
    faces,
    elements,
    fallbackColor: getFallbackColor(assetKey)
  }
}

function chooseModelReference(blockstate: JsonRecord, properties: Readonly<Record<string, string>>): ModelReference {
  const variants = asRecord(blockstate.variants)
  if (variants) {
    const propertyKey = createVariantKey(properties)
    const exactVariant = asVariantRecord(variants[propertyKey])
    if (exactVariant) {
      return toModelReference(exactVariant)
    }

    for (const [variantKey, value] of Object.entries(variants)) {
      if (variantKeyMatchesProperties(variantKey, properties)) {
        const matched = asVariantRecord(value)
        if (matched) {
          return toModelReference(matched)
        }
      }
    }

    const defaultVariant = asVariantRecord(variants[''])
    if (defaultVariant) {
      return toModelReference(defaultVariant)
    }

    const firstVariant = Object.values(variants)[0]
    const firstRecord = asVariantRecord(firstVariant)
    return firstRecord ? toModelReference(firstRecord) : { model: 'block/missing', yRotation: 0 }
  }

  const multipart = Array.isArray(blockstate.multipart) ? blockstate.multipart : []
  const firstApply = asRecord(asRecord(multipart[0])?.apply)
  return firstApply ? toModelReference(firstApply) : { model: 'block/missing', yRotation: 0 }
}

function toModelReference(record: JsonRecord): ModelReference {
  return {
    model: getString(record.model) ?? 'block/missing',
    yRotation: normalizeRightAngleRotation(typeof record.y === 'number' ? record.y : 0)
  }
}

async function resolveModel(
  source: AssetSource,
  defaultNamespace: string,
  modelReference: string,
  depth = 0
): Promise<ResolvedModel> {
  if (depth > MAX_MODEL_DEPTH) {
    return { textures: {}, faceTextureReferences: {}, elements: [], warning: 'Model parent chain is too deep.' }
  }

  const id = parseResourceId(modelReference, defaultNamespace)
  const model = await readAssetJson(source, `assets/${id.namespace}/models/${id.path}.json`)
  if (!model) {
    return { textures: {}, faceTextureReferences: {}, elements: [], warning: `Missing model ${id.namespace}:${id.path}.` }
  }

  const parentReference = getString(model.parent)
  const parentModel = parentReference ? await resolveModel(source, id.namespace, parentReference, depth + 1) : null
  const ownTextures = asStringRecord(model.textures)
  const ownFaceTextureReferences = extractFaceTextureReferences(model)
  const ownElements = extractModelElements(model)

  const resolved: ResolvedModel = {
    textures: {
      ...(parentModel?.textures ?? {}),
      ...ownTextures
    },
    faceTextureReferences: Object.keys(ownFaceTextureReferences).length > 0 ? ownFaceTextureReferences : (parentModel?.faceTextureReferences ?? {}),
    elements: ownElements.length > 0 ? ownElements : (parentModel?.elements ?? [])
  }

  if (parentModel?.warning) {
    return { ...resolved, warning: parentModel.warning }
  }

  return resolved
}

function resolveFaceTextureIds(
  namespace: string,
  blockPath: string,
  model: ResolvedModel
): Record<keyof BlockFaceTextures, string> {
  const textures = model.textures
  const modelFaces = model.faceTextureReferences
  const direct = `${namespace}:block/${blockPath}`
  const resolvedModelFaces = {
    up: resolveTextureReference(modelFaces.up, textures),
    down: resolveTextureReference(modelFaces.down, textures),
    north: resolveTextureReference(modelFaces.north, textures),
    south: resolveTextureReference(modelFaces.south, textures),
    east: resolveTextureReference(modelFaces.east, textures),
    west: resolveTextureReference(modelFaces.west, textures)
  }
  const all = resolveTextureReference(textures.all, textures)
  const side = resolveTextureReference(textures.side, textures) ?? all
  const top = resolvedModelFaces.up ?? resolveTextureReference(textures.top, textures) ?? resolveTextureReference(textures.up, textures) ?? all ?? side
  const bottom =
    resolvedModelFaces.down ??
    resolveTextureReference(textures.bottom, textures) ??
    resolveTextureReference(textures.down, textures) ??
    all ??
    side ??
    top
  const north = resolvedModelFaces.north ?? resolveTextureReference(textures.north, textures) ?? side ?? all ?? top
  const south = resolvedModelFaces.south ?? resolveTextureReference(textures.south, textures) ?? side ?? north
  const east = resolvedModelFaces.east ?? resolveTextureReference(textures.east, textures) ?? side ?? north
  const west = resolvedModelFaces.west ?? resolveTextureReference(textures.west, textures) ?? side ?? north

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

function extractFaceTextureReferences(model: JsonRecord): Partial<Record<FaceName, string>> {
  const elements = Array.isArray(model.elements) ? model.elements : []
  const references: Partial<Record<FaceName, string>> = {}

  for (const element of elements) {
    const faces = asRecord(asRecord(element)?.faces)
    if (!faces) {
      continue
    }

    for (const face of ['up', 'down', 'north', 'south', 'east', 'west'] as const) {
      if (references[face]) {
        continue
      }

      const textureReference = getString(asRecord(faces[face])?.texture)
      if (textureReference) {
        references[face] = textureReference
      }
    }
  }

  return references
}

function extractModelElements(model: JsonRecord): readonly ModelElementDefinition[] {
  const elements = Array.isArray(model.elements) ? model.elements : []
  return elements.flatMap((element) => {
    const record = asRecord(element)
    const from = readModelCoordinate(record?.from)
    const to = readModelCoordinate(record?.to)
    if (!record || !from || !to) {
      return []
    }

    return [
      {
        from,
        to,
        faceTextureReferences: extractFaceTextureReferences({ elements: [record] }),
        faceUvs: extractFaceUvs(record)
      }
    ]
  })
}

function extractFaceUvs(element: JsonRecord): Partial<Record<FaceName, ModelUv>> {
  const faces = asRecord(element.faces)
  const uvs: Partial<Record<FaceName, ModelUv>> = {}
  if (!faces) {
    return uvs
  }

  for (const face of ['up', 'down', 'north', 'south', 'east', 'west'] as const) {
    const uv = readModelUv(asRecord(faces[face])?.uv)
    if (uv) {
      uvs[face] = uv
    }
  }

  return uvs
}

async function resolveModelElements(
  source: AssetSource,
  defaultNamespace: string,
  model: ResolvedModel,
  defaultFaceTextureIds: Record<keyof BlockFaceTextures, string>,
  yRotation: number
): Promise<readonly BlockModelElement[] | null> {
  const elements = model.elements.length > 0 ? model.elements : [createFullCubeElement(model.faceTextureReferences)]
  const resolved = await Promise.all(
    elements.map(async (element) => {
      const textureIds = resolveElementFaceTextureIds(defaultNamespace, model.textures, element.faceTextureReferences, defaultFaceTextureIds)
      const faces = await loadFaceTextures(source, textureIds)
      if (!faces) {
        return null
      }

      const rotated = rotateElementY(element, yRotation)
      return {
        from: rotated.from,
        to: rotated.to,
        faces,
        ...(Object.keys(element.faceUvs).length > 0 ? { uvs: element.faceUvs } : {})
      }
    })
  )

  return resolved.every((element): element is BlockModelElement => element !== null) ? resolved : null
}

function createFullCubeElement(faceTextureReferences: Readonly<Partial<Record<FaceName, string>>>): ModelElementDefinition {
  return {
    from: [0, 0, 0],
    to: [16, 16, 16],
    faceTextureReferences,
    faceUvs: {}
  }
}

function resolveElementFaceTextureIds(
  defaultNamespace: string,
  textures: Readonly<Record<string, string>>,
  faceTextureReferences: Readonly<Partial<Record<FaceName, string>>>,
  defaultFaceTextureIds: Record<keyof BlockFaceTextures, string>
): Record<keyof BlockFaceTextures, string> {
  return {
    up: toTextureId(resolveTextureReference(faceTextureReferences.up, textures) ?? defaultFaceTextureIds.up, defaultNamespace),
    down: toTextureId(resolveTextureReference(faceTextureReferences.down, textures) ?? defaultFaceTextureIds.down, defaultNamespace),
    north: toTextureId(resolveTextureReference(faceTextureReferences.north, textures) ?? defaultFaceTextureIds.north, defaultNamespace),
    south: toTextureId(resolveTextureReference(faceTextureReferences.south, textures) ?? defaultFaceTextureIds.south, defaultNamespace),
    east: toTextureId(resolveTextureReference(faceTextureReferences.east, textures) ?? defaultFaceTextureIds.east, defaultNamespace),
    west: toTextureId(resolveTextureReference(faceTextureReferences.west, textures) ?? defaultFaceTextureIds.west, defaultNamespace)
  }
}

function rotateElementY(element: ModelElementDefinition, yRotation: number): Pick<ModelElementDefinition, 'from' | 'to'> {
  if (yRotation === 0) {
    return { from: element.from, to: element.to }
  }

  const corners: ModelCoordinate[] = [
    [element.from[0], element.from[1], element.from[2]],
    [element.from[0], element.from[1], element.to[2]],
    [element.to[0], element.from[1], element.from[2]],
    [element.to[0], element.from[1], element.to[2]],
    [element.from[0], element.to[1], element.from[2]],
    [element.from[0], element.to[1], element.to[2]],
    [element.to[0], element.to[1], element.from[2]],
    [element.to[0], element.to[1], element.to[2]]
  ]
  const rotated = corners.map((corner) => rotateCoordinateY(corner, yRotation))
  const xs = rotated.map((corner) => corner[0])
  const ys = rotated.map((corner) => corner[1])
  const zs = rotated.map((corner) => corner[2])

  return {
    from: [Math.min(...xs), Math.min(...ys), Math.min(...zs)],
    to: [Math.max(...xs), Math.max(...ys), Math.max(...zs)]
  }
}

function rotateCoordinateY(coordinate: ModelCoordinate, yRotation: number): ModelCoordinate {
  const x = coordinate[0] - 8
  const z = coordinate[2] - 8
  switch (yRotation) {
    case 90:
      return [8 - z, coordinate[1], 8 + x]
    case 180:
      return [8 - x, coordinate[1], 8 - z]
    case 270:
      return [8 + z, coordinate[1], 8 - x]
    default:
      return coordinate
  }
}

function readModelCoordinate(value: unknown): ModelCoordinate | null {
  if (!Array.isArray(value) || value.length !== 3) {
    return null
  }

  const [x, y, z] = value
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
    return null
  }

  return [x, y, z]
}

function readModelUv(value: unknown): ModelUv | null {
  if (!Array.isArray(value) || value.length !== 4) {
    return null
  }

  const [u1, v1, u2, v2] = value
  if (typeof u1 !== 'number' || typeof v1 !== 'number' || typeof u2 !== 'number' || typeof v2 !== 'number') {
    return null
  }

  return [u1, v1, u2, v2]
}

async function resolveSpecialBlockAsset(assetKey: string, block: BlockAssetRequest): Promise<ResolvedBlockAsset | null> {
  const normalized = block.blockName.toLowerCase()
  if (!activeSource || !/minecraft:(trapped_)?chest$|minecraft:ender_chest$/.test(normalized)) {
    return null
  }

  const chestTexture = normalized.includes('ender_chest')
    ? 'minecraft:entity/chest/ender'
    : normalized.includes('trapped_chest')
      ? 'minecraft:entity/chest/trapped'
      : 'minecraft:entity/chest/normal'
  const faces = await loadFaceTextures(activeSource, {
    up: chestTexture,
    down: chestTexture,
    north: chestTexture,
    south: chestTexture,
    east: chestTexture,
    west: chestTexture
  })

  if (!faces) {
    return null
  }

  return {
    assetKey,
    blockName: block.blockName,
    properties: block.properties,
    status: 'textured-cube',
    sourceName: activeSource.name,
    faces,
    elements: [
      {
        from: [1, 0, 1],
        to: [15, 14, 15],
        faces,
        uvSize: [64, 64],
        uvs: {
          up: [14, 0, 28, 14],
          down: [28, 19, 42, 33],
          north: [14, 33, 28, 47],
          south: [14, 14, 28, 28],
          east: [0, 33, 14, 47],
          west: [28, 33, 42, 47]
        }
      }
    ],
    fallbackColor: getFallbackColor(assetKey),
    warning: 'Using entity chest texture on a simplified chest cuboid.'
  }
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
  return archivePriority(archivePath) * 10 + (name.includes(namespace) ? 0 : 1)
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

function normalizeBlockId(blockName: string): string {
  const trimmed = blockName.trim().toLowerCase()
  if (trimmed.length === 0) {
    return 'minecraft:air'
  }
  return trimmed.includes(':') ? trimmed : `minecraft:${trimmed}`
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
    elements: [],
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
  const summary: AssetSourceSummary = {
    id: source.id,
    name: source.name,
    rootPath: source.rootPath,
    kind: source.kind,
    minecraftVersion: source.minecraftVersion,
    archiveCount: source.archiveCount,
    looseAssetRootCount: source.looseAssetRootCount,
    hasVanillaJar: source.hasVanillaJar,
    vanillaStatus: source.vanillaStatus
  }
  if (source.vanillaMessage) {
    return { ...summary, vanillaMessage: source.vanillaMessage }
  }

  return summary
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
  return archivePriority(a) - archivePriority(b) || a.localeCompare(b)
}

function archivePriority(archivePath: string): number {
  if (archivePath.includes(`${sep}resourcepacks${sep}`)) return 0
  if (archivePath.includes(`${sep}mods${sep}`)) return 1
  if (archivePath.includes(`${sep}versions${sep}`)) return 2
  if (archivePath.startsWith(vanillaCacheRoot)) return 3
  return 4
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

async function mapWithConcurrency<T>(
  values: readonly T[],
  concurrency: number,
  mapper: (value: T) => Promise<void>
): Promise<void> {
  const workers = Array.from({ length: Math.min(Math.max(1, concurrency), values.length) }, async (_, workerIndex) => {
    for (let index = workerIndex; index < values.length; index += concurrency) {
      const value = values[index]
      if (value !== undefined) {
        await mapper(value)
      }
    }
  })

  await Promise.all(workers)
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

function normalizeRightAngleRotation(value: number): number {
  const normalized = ((Math.round(value / 90) * 90) % 360 + 360) % 360
  return normalized === 90 || normalized === 180 || normalized === 270 ? normalized : 0
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths)]
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_')
}

function createFetchDownloadClient(): DownloadClient {
  return {
    async getJson(url) {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status} for ${url}`)
      }

      return (await response.json()) as JsonRecord
    },
    async getBuffer(url) {
      const response = await fetch(url)
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status} for ${url}`)
      }

      return Buffer.from(await response.arrayBuffer())
    }
  }
}
