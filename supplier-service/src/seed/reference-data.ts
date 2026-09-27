import { nameKey } from '../common/normalise/normalise.js';
import { SupplierKind } from '../database/entities/index.js';
import type { CreateBuildingInput } from '../buildings/buildings.service.js';

/**
 * The initial campus building list. Aliases cover every building spelling in
 * data/csv/supplier-seed-data.csv (F12.2.1). The seed file has no building
 * coordinates, so each building's are the average of its seed suppliers',
 * computed once and fixed here.
 */
export const SEED_BUILDINGS: CreateBuildingInput[] = [
  {
    canonicalName: 'Central Library',
    shortName: 'CLB',
    aliases: [],
    latitude: 1.296558,
    longitude: 103.773111,
  },
  {
    canonicalName: 'Computing 2',
    shortName: 'COM2',
    aliases: ['Com 2'],
    latitude: 1.293925,
    longitude: 103.774152,
  },
  {
    // The Terrace is the food court inside COM3.
    canonicalName: 'Computing 3',
    shortName: 'COM3',
    aliases: ['Terrace', 'The Terrace'],
    latitude: 1.29436,
    longitude: 103.77263,
  },
  {
    canonicalName: "Prince George's Park",
    shortName: 'PGP',
    aliases: ['Prince George’s Park'],
    latitude: 1.290888,
    longitude: 103.777828,
  },
  {
    canonicalName: 'Engineering Block E3',
    shortName: 'E3',
    aliases: [],
    latitude: 1.299434,
    longitude: 103.75263,
  },
  {
    canonicalName: 'Engineering Block E4',
    shortName: 'E4',
    aliases: [],
    latitude: 1.299152,
    longitude: 103.769064,
  },
  {
    canonicalName: 'Engineering Block EA',
    shortName: 'EA',
    aliases: [],
    latitude: 1.300567,
    longitude: 103.770758,
  },
  {
    canonicalName: 'The Ridge',
    shortName: 'The Ridge',
    aliases: [],
    latitude: 1.294678,
    longitude: 103.770787,
  },
  {
    canonicalName: 'Yusof Ishak House',
    shortName: 'YIH',
    aliases: [],
    latitude: 1.298465,
    longitude: 103.77234,
  },
  {
    canonicalName: 'Frontier',
    shortName: 'Frontier',
    aliases: [],
    latitude: 1.294782,
    longitude: 103.770443,
  },
  {
    canonicalName: 'Hon Sui Sen Memorial Library',
    shortName: 'HSSML',
    aliases: [],
    latitude: 1.293126,
    longitude: 103.771994,
  },
  {
    canonicalName: 'innovation4.0',
    shortName: 'i4.0',
    aliases: [],
    latitude: 1.294298,
    longitude: 103.770881,
  },
  {
    canonicalName: 'Medicine+Science Library',
    shortName: 'MSL',
    aliases: [],
    latitude: 1.296799,
    longitude: 103.779434,
  },
  {
    canonicalName: 'Blk AS8',
    shortName: 'AS8',
    aliases: [],
    latitude: 1.296252,
    longitude: 103.772093,
  },
];

/** Seed suppliers that are not Stores, by seed Name (F12.2.5). */
const KIND_OVERRIDES = new Map<string, SupplierKind>([
  [nameKey('Printer @ Com 2'), SupplierKind.Facility],
]);

/**
 * Seed suppliers renamed so outlets inside a food court stay distinct from
 * other outlets of the same business in that building, by seed Name.
 */
const NAME_OVERRIDES = new Map<string, string>([
  [nameKey('InstaChef'), 'InstaChef (Terrace)'],
  [nameKey('Smooy'), 'Smooy (Terrace)'],
]);

/** The kind for a seed row, defaulting to Store (F12.2.5). */
export function seedKind(seedName: string): SupplierKind {
  return KIND_OVERRIDES.get(nameKey(seedName)) ?? SupplierKind.Store;
}

/** The configured replacement name for a seed row, if any. */
export function seedNameOverride(seedName: string): string | undefined {
  return NAME_OVERRIDES.get(nameKey(seedName));
}
