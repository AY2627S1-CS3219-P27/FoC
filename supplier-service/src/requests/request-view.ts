import type {
  RequestState,
  RequestType,
  SupplierRequest,
} from '../database/entities/index.js';

/** A supplier request as returned by the API (F6.2, F6.7). */
export interface RequestView {
  id: string;
  type: RequestType;
  state: RequestState;
  /** The target supplier and its version at submission (Update, StatusChange). */
  supplierId: string | null;
  supplierVersion: number | null;
  /** The submitted values. */
  values: Record<string, unknown>;
  submittedBy: string;
  submittedAt: Date;
  resolvedBy: string | null;
  resolvedAt: Date | null;
  denialReason: string | null;
  /** For an approved Create request: the supplier it created. */
  createdSupplierId: string | null;
}

export function toRequestView(request: SupplierRequest): RequestView {
  return {
    id: request.id,
    type: request.type,
    state: request.state,
    supplierId: request.supplierId,
    supplierVersion: request.supplierVersion,
    values: request.payload,
    submittedBy: request.submittedBy,
    submittedAt: request.submittedAt,
    resolvedBy: request.resolvedBy,
    resolvedAt: request.resolvedAt,
    denialReason: request.denialReason,
    createdSupplierId: request.createdSupplierId,
  };
}
