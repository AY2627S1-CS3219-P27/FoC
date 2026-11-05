import { randomUUID } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, IsNull, type Repository } from 'typeorm';
import { ErrorCode } from '../common/errors/error-response.js';
import { normaliseFloor } from '../common/normalise/normalise.js';
import { Venue } from '../database/entities/index.js';

export interface CreateVenueInput {
  buildingId: string;
  code: string;
  name: string | null;
  floor: string;
  latitude: number;
  longitude: number;
}

/**
 * Delivery venues: rooms inside buildings where an order can be handed over.
 * Venues are retired, never deleted, so historical orders still resolve.
 */
@Injectable()
export class VenuesService {
  constructor(
    @InjectRepository(Venue) private readonly venues: Repository<Venue>,
  ) {}

  /**
   * A building's non-retired venues: basements first (deepest first), then
   * numeric floors, then "M", then by code in natural order (LT2 before LT10).
   */
  async listActive(buildingId: string): Promise<Venue[]> {
    const venues = await this.venues.findBy({
      buildingId,
      retiredAt: IsNull(),
    });
    // ponytail: sorted here, not in SQL; a building has tens of venues, not thousands.
    return venues.sort(
      (a, b) =>
        floorRank(a.floor) - floorRank(b.floor) ||
        a.code.localeCompare(b.code, 'en', { numeric: true }),
    );
  }

  /**
   * Active venue counts per building, from one grouped query. A building with
   * no active venues has no entry.
   */
  async countActiveByBuilding(): Promise<Map<string, number>> {
    const rows = await this.venues
      .createQueryBuilder('venue')
      .select('venue.building_id', 'buildingId')
      .addSelect('COUNT(*)::int', 'count')
      .where('venue.retired_at IS NULL')
      .groupBy('venue.building_id')
      .getRawMany<{ buildingId: string; count: number }>();
    return new Map(rows.map((row) => [row.buildingId, row.count]));
  }

  /**
   * The non-retired venue with this id in this building; null when it is
   * unknown, retired, or in another building. Given a manager, it reads on
   * that transaction's connection.
   */
  findInUse(
    buildingId: string,
    venueId: string,
    manager?: EntityManager,
  ): Promise<Venue | null> {
    const repository = manager ? manager.getRepository(Venue) : this.venues;
    return repository.findOneBy({
      id: venueId,
      buildingId,
      retiredAt: IsNull(),
    });
  }

  create(input: CreateVenueInput): Promise<Venue> {
    return this.venues.save(
      this.venues.create({
        id: randomUUID(),
        buildingId: input.buildingId,
        code: input.code.trim(),
        name: input.name?.trim() || null,
        floor: normaliseFloor(input.floor),
        latitude: input.latitude,
        longitude: input.longitude,
        retiredAt: null,
      }),
    );
  }

  /** Retires a venue; retiring an already retired venue is a no-op. */
  async retire(id: string): Promise<Venue> {
    const venue = await this.venues.findOneBy({ id });
    if (!venue) {
      throw new NotFoundException({
        code: ErrorCode.NotFound,
        message: `Venue ${id} does not exist.`,
      });
    }
    if (venue.retiredAt === null) {
      venue.retiredAt = new Date();
      return this.venues.save(venue);
    }
    return venue;
  }
}

/** Basements deepest first, then numeric floors, then the mezzanine. */
function floorRank(floor: string): number {
  if (floor === 'M') {
    return 1000;
  }
  return floor.startsWith('B') ? -Number(floor.slice(1)) : Number(floor);
}
