import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));
vi.mock("@/lib/api", () => ({ api: mocks.api }));

import { CreditTransactionHistory } from "./credit-transaction-history";

const me = "11111111-1111-4111-8111-111111111111";
const other = "33333333-3333-4333-8333-333333333333";
const errandId = "aaaaaaaa-2222-4222-8222-222222222222";

function tx(id: string, type: "TRANSFER" | "RESERVATION") {
  return {
    transactionId: id,
    type,
    datetime: "2026-01-01T00:00:00.000Z",
    amount: 10,
    errandId,
    origin: { userId: type === "TRANSFER" ? other : me, balanceType: "RESERVED_BALANCE" },
    destination: { userId: me, balanceType: "CREDIT_BALANCE" },
  };
}

describe("CreditTransactionHistory", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.api.mockImplementation(async (_m: string, path: string) => {
      if (path.startsWith("/api/credits/transactions")) {
        return {
          ok: true,
          data: { items: [tx("t1", "TRANSFER"), tx("t2", "RESERVATION")], total: 2 },
        };
      }
      if (path === `/api/errands/${errandId}`) {
        return {
          ok: true,
          data: { pickupName: "Starbucks", deliveryLocation: "COM1", supplierId: "s", collectionItems: "x" },
        };
      }
      if (path === `/api/users/${other}`) return { ok: true, data: { displayName: "Alice" } };
      return { ok: false };
    });
  });

  it("shows the errand title and counterparty name, fetching the errand once", async () => {
    render(<CreditTransactionHistory userId={me} />);
    await waitFor(() => expect(screen.getAllByText("Starbucks → COM1")).toHaveLength(2));
    expect(screen.getByText("From Alice")).toBeTruthy();
    const errandCalls = mocks.api.mock.calls.filter(([, p]) => p === `/api/errands/${errandId}`);
    expect(errandCalls).toHaveLength(1);
  });
});
