import type { BlockEntityKind } from './structure'

export interface BlockEntityCapability {
  readonly kind: BlockEntityKind
  readonly supportsLootTable: boolean
}

const LOOTABLE_CONTAINER_BLOCKS = new Set([
  'minecraft:barrel',
  'minecraft:blast_furnace',
  'minecraft:brewing_stand',
  'minecraft:chest',
  'minecraft:dispenser',
  'minecraft:dropper',
  'minecraft:furnace',
  'minecraft:hopper',
  'minecraft:smoker',
  'minecraft:trapped_chest'
])

const ITEM_CONTAINER_BLOCKS = new Set([
  'minecraft:chiseled_bookshelf',
  'minecraft:crafter'
])

const GENERIC_BLOCK_ENTITY_BLOCKS = new Set([
  'minecraft:beacon',
  'minecraft:bed',
  'minecraft:beehive',
  'minecraft:bell',
  'minecraft:calibrated_sculk_sensor',
  'minecraft:campfire',
  'minecraft:command_block',
  'minecraft:comparator',
  'minecraft:conduit',
  'minecraft:daylight_detector',
  'minecraft:decorated_pot',
  'minecraft:enchanting_table',
  'minecraft:end_gateway',
  'minecraft:end_portal',
  'minecraft:jigsaw',
  'minecraft:jukebox',
  'minecraft:lectern',
  'minecraft:mob_spawner',
  'minecraft:piston',
  'minecraft:sculk_catalyst',
  'minecraft:sculk_sensor',
  'minecraft:sign',
  'minecraft:structure_block',
  'minecraft:suspicious_gravel',
  'minecraft:suspicious_sand',
  'minecraft:trial_spawner',
  'minecraft:vault'
])

export function getKnownBlockEntityCapability(blockName: string): BlockEntityCapability | null {
  const normalized = normalizeBlockId(blockName)

  if (normalized === 'minecraft:jigsaw') {
    return { kind: 'jigsaw', supportsLootTable: false }
  }

  if (LOOTABLE_CONTAINER_BLOCKS.has(normalized) || normalized.endsWith('_shulker_box')) {
    return { kind: 'container', supportsLootTable: true }
  }

  if (ITEM_CONTAINER_BLOCKS.has(normalized)) {
    return { kind: 'container', supportsLootTable: false }
  }

  if (
    GENERIC_BLOCK_ENTITY_BLOCKS.has(normalized) ||
    normalized.endsWith('_banner') ||
    normalized.endsWith('_bed') ||
    normalized.endsWith('_hanging_sign') ||
    normalized.endsWith('_head') ||
    normalized.endsWith('_skull') ||
    normalized.endsWith('_sign')
  ) {
    return { kind: 'generic', supportsLootTable: false }
  }

  if (hasModdedContainerNameHint(normalized)) {
    return { kind: 'container', supportsLootTable: true }
  }

  return null
}

export function inferBlockEntityCapability(
  id: string,
  blockName: string,
  fields: Readonly<Record<string, unknown>>
): BlockEntityCapability {
  const idCapability = getKnownBlockEntityCapability(id)
  const blockCapability = getKnownBlockEntityCapability(blockName)

  if (idCapability?.kind === 'jigsaw' || blockCapability?.kind === 'jigsaw') {
    return { kind: 'jigsaw', supportsLootTable: false }
  }

  if (fields.LootTable !== undefined || fields.Items !== undefined) {
    return { kind: 'container', supportsLootTable: fields.LootTable !== undefined }
  }

  return idCapability ?? blockCapability ?? { kind: 'generic', supportsLootTable: false }
}

function normalizeBlockId(blockName: string): string {
  const trimmed = blockName.trim().toLowerCase()
  if (trimmed.length === 0) {
    return 'minecraft:air'
  }
  return trimmed.includes(':') ? trimmed : `minecraft:${trimmed}`
}

function hasModdedContainerNameHint(blockName: string): boolean {
  const [namespace, path = ''] = blockName.split(':')
  if (namespace === 'minecraft') {
    return false
  }

  const tokens = `${namespace}/${path}`.split(/[^a-z0-9]+/)
  return tokens.some((token) =>
    ['chest', 'barrel', 'crate', 'container', 'inventory', 'storage', 'drawer', 'cabinet', 'locker', 'safe', 'box', 'vault'].includes(token)
  )
}
