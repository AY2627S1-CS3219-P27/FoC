import { randomUUID } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource, type EntityManager } from 'typeorm';
import { ErrorCode } from '../common/errors/error-response.js';
import { nameKey } from '../common/normalise/normalise.js';
import {
  RequestState,
  RequestType,
  SupplierRequest,
} from '../database/entities/index.js';
import { isUniqueViolation } from '../database/postgres-errors.js';
import type { Page } from '../suppliers/supplier-view.js';
import { SuppliersService } from '../suppliers/suppliers.service.js';
import type { ListRequestsQueryDto } from './dto/list-requests-query.dto.js';
import { canMove } from './request-state.js';
import { type RequestView, toRequestView } from './request-view.js';

/**
 * Admin-moderated supplier requests (F6). Basic users file requests; admins
 * list the Pending ones, and approve or deny each exactly once. Approving
 * reuses the same SuppliersService code as a direct admin change, inside the
 * same transaction as recording the approval (F6.8).
 */
@Injectable()
export class SupplierRequestsService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly suppliers: SuppliersService,
  ) {}

  /**
   * Files a request to add a supplier (F7.1). It is validated exactly like a
   * direct create, and refused if the supplier already exists (F1.5) or an
   * identical request is already Pending (F7.2). The supplier itself only
   * exists, and is only listed, once an admin approves.
   */
  async submitCreation(input: unknown, userId: string): Promise<RequestView> {
    const values = await this.suppliers.validateNew(input);
    if (
      await this.suppliers.exists(values.name, values.buildingId, values.floor)
    ) {
      throw new ConflictException({
        code: ErrorCode.DuplicateSupplier,
        message:
          'A supplier with the same name already exists on this floor of this building.',
      });
    }

    const request = this.dataSource.manager.create(SupplierRequest, {
      id: randomUUID(),
      type: RequestType.Create,
      state: RequestState.Pending,
      supplierId: null,
      supplierVersion: null,
      // The validated, normalised values, as plain JSON.
      payload: JSON.parse(JSON.stringify(values)) as Record<string, unknown>,
      nameKey: nameKey(values.name),
      buildingId: values.buildingId,
      floor: values.floor,
      submittedBy: userId,
      resolvedBy: null,
      resolvedAt: null,
      denialReason: null,
      createdSupplierId: null,
    });
    return withPendingDuplicateMapped(async () =>
      toRequestView(await this.dataSource.manager.save(request)),
    );
  }

  /**
   * Files a request to edit a supplier (F8.1), based on the version the user
   * last saw (F6.2): it is validated exactly like an admin edit, including
   * whether the edited record would duplicate another supplier. The live
   * supplier is unchanged until an admin approves (F8.2), and a supplier
   * has at most one Pending update request (F8.3).
   */
  async submitUpdate(
    supplierId: string,
    expectedVersion: number,
    changes: unknown,
    userId: string,
  ): Promise<RequestView> {
    return withPendingDuplicateMapped(() =>
      this.dataSource.transaction(async (manager) => {
        const values = await this.suppliers.validatePatch(
          supplierId,
          expectedVersion,
          changes,
          manager,
        );
        const request = manager.create(SupplierRequest, {
          id: randomUUID(),
          type: RequestType.Update,
          state: RequestState.Pending,
          supplierId,
          supplierVersion: expectedVersion,
          // Only the supplied fields, validated and normalised, as plain JSON.
          payload: JSON.parse(JSON.stringify(values)) as Record<
            string,
            unknown
          >,
          nameKey: null,
          buildingId: null,
          floor: null,
          submittedBy: userId,
          resolvedBy: null,
          resolvedAt: null,
          denialReason: null,
          createdSupplierId: null,
        });
        return toRequestView(await manager.save(request));
      }),
    );
  }

  /** Pending requests, optionally of one type, oldest first (F6.7, N3.1). */
  async listPending(query: ListRequestsQueryDto): Promise<Page<RequestView>> {
    const { offset, limit } = query;
    const [requests, total] = await this.dataSource.manager.findAndCount(
      SupplierRequest,
      {
        where: {
          state: RequestState.Pending,
          ...(query.type !== undefined && { type: query.type }),
        },
        order: { submittedAt: 'ASC', id: 'ASC' },
        skip: offset,
        take: limit,
      },
    );
    return {
      items: requests.map(toRequestView),
      total,
      offset,
      limit,
      hasMore: offset + requests.length < total,
    };
  }

  /**
   * Approves a Pending request: applies its effect and records who approved
   * it and when, in one transaction; if the effect fails, neither is saved
   * and the request stays Pending (F6.8). A creation is re-checked against
   * existing suppliers at this moment (F7.3.1).
   */
  async approve(id: string, adminId: string): Promise<RequestView> {
    return this.dataSource.transaction(async (manager) => {
      const request = await lockPending(manager, id, RequestState.Approved);

      switch (request.type) {
        case RequestType.Create: {
          const supplier = await this.suppliers.create(
            request.payload,
            manager,
          );
          request.createdSupplierId = supplier.id;
          break;
        }
        case RequestType.Update:
          // Refused with VERSION_CONFLICT if the supplier changed since the
          // request was filed (F8.4.1).
          await this.suppliers.update(
            request.supplierId!,
            request.supplierVersion!,
            request.payload,
            manager,
          );
          break;
        default:
          // StatusChange requests cannot be filed yet.
          throw new ConflictException({
            code: ErrorCode.Conflict,
            message: `${request.type} requests cannot be approved yet.`,
          });
      }

      request.state = RequestState.Approved;
      request.resolvedBy = adminId;
      request.resolvedAt = new Date();
      return toRequestView(await manager.save(request));
    });
  }

  /** Denies a Pending request, recording who, when and why (F6.4). */
  async deny(
    id: string,
    adminId: string,
    reason: string,
  ): Promise<RequestView> {
    return this.dataSource.transaction(async (manager) => {
      const request = await lockPending(manager, id, RequestState.Denied);
      request.state = RequestState.Denied;
      request.resolvedBy = adminId;
      request.resolvedAt = new Date();
      request.denialReason = reason;
      return toRequestView(await manager.save(request));
    });
  }
}

/**
 * Turns a partial unique index firing into 409 DUPLICATE_REQUEST. The index
 * decides, so two requests filed at the same moment cannot both be Pending:
 * one creation per duplicate key (F7.2), one update per supplier (F8.3).
 */
async function withPendingDuplicateMapped<T>(
  work: () => Promise<T>,
): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (isUniqueViolation(error, 'UQ_supplier_requests_pending_create')) {
      throw new ConflictException({
        code: ErrorCode.DuplicateRequest,
        message:
          'An identical request to add this supplier is already pending.',
      });
    }
    if (isUniqueViolation(error, 'UQ_supplier_requests_pending_target')) {
      throw new ConflictException({
        code: ErrorCode.DuplicateRequest,
        message: 'This supplier already has a pending request of this type.',
      });
    }
    throw error;
  }
}

/**
 * Loads the request with a row lock held until the transaction ends, so two
 * admins acting on it at once cannot both succeed, and checks it can still
 * move to the target state: a resolved request is 409 (F6.3).
 */
async function lockPending(
  manager: EntityManager,
  id: string,
  to: RequestState,
): Promise<SupplierRequest> {
  const request = await manager.findOne(SupplierRequest, {
    where: { id },
    lock: { mode: 'pessimistic_write' },
  });
  if (!request) {
    throw new NotFoundException({
      code: ErrorCode.RequestNotFound,
      message: `Request ${id} does not exist.`,
    });
  }
  if (!canMove(request.state, to)) {
    throw new ConflictException({
      code: ErrorCode.RequestAlreadyResolved,
      message: `The request is already ${request.state}.`,
    });
  }
  return request;
}
