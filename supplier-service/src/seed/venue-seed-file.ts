import Joi from 'joi';
import type { CreateBuildingInput } from '../buildings/buildings.service.js';
import { FLOOR_PATTERN } from '../common/normalise/normalise.js';

/** One venue row of the seed JSON. */
export interface SeedVenue {
  buildingShortName: string;
  code: string;
  name: string | null;
  floor: string;
  latitude: number;
  longitude: number;
  /** Set by the data cleaning for rows that must not reach users. */
  needsReview: boolean;
}

/** The seed JSON: the one source of truth for buildings and venues. */
export interface VenueSeedFile {
  buildings: CreateBuildingInput[];
  venues: SeedVenue[];
}

/** The file cannot be read at all (not configured, missing, no access). */
export class SeedFileUnreadableError extends Error {}

const latitude = Joi.number().min(-90).max(90).required();
const longitude = Joi.number().min(-180).max(180).required();

// Unknown keys are tolerated, so a fresh export of the cleaned file with its
// extra analysis columns still loads.
const fileSchema = Joi.object<VenueSeedFile>({
  buildings: Joi.array()
    .items(
      Joi.object({
        shortName: Joi.string().trim().min(1).required(),
        canonicalName: Joi.string().trim().min(1).required(),
        aliases: Joi.array().items(Joi.string().trim().min(1)).required(),
        latitude,
        longitude,
      }).unknown(true),
    )
    .min(1)
    .required(),
  venues: Joi.array()
    .items(
      Joi.object({
        buildingShortName: Joi.string().trim().min(1).required(),
        code: Joi.string().trim().min(1).max(30).required(),
        name: Joi.string().trim().min(1).max(100).allow(null).required(),
        floor: Joi.string().pattern(FLOOR_PATTERN).required(),
        latitude,
        longitude,
        needsReview: Joi.boolean().required(),
      }).unknown(true),
    )
    .required(),
}).unknown(true);

/**
 * Parses and checks the seed JSON. Throws on anything malformed, so a bad file
 * fails startup instead of loading half of it.
 */
export function parseVenueSeed(bytes: Uint8Array): VenueSeedFile {
  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (error) {
    throw new Error(
      `Venue seed file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const { error, value } = fileSchema.validate(json, {
    abortEarly: false,
    convert: false,
  });
  if (error) {
    throw new Error(`Venue seed file is malformed: ${error.message}`);
  }

  const buildingNames = new Set(value.buildings.map((b) => b.shortName));
  const seen = new Set<string>();
  const problems: string[] = [];
  for (const venue of value.venues) {
    const id = `${venue.buildingShortName}/${venue.code}`;
    if (!buildingNames.has(venue.buildingShortName)) {
      problems.push(`${id}: unknown building`);
    }
    if (seen.has(id)) {
      problems.push(`${id}: duplicate code in building`);
    }
    seen.add(id);
  }
  if (problems.length > 0) {
    throw new Error(`Venue seed file is malformed: ${problems.join('; ')}`);
  }
  return value;
}
