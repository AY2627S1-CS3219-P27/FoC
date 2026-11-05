import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CreditTransactionHistory,
  getTransactionPresentation,
  type CreditTransaction,
  type CreditTransactionPage,
} from "./credit-transaction-history";

const { mockApi } = vi.hoisted(() => ({ mockApi: vi.fn() }));

vi.mock("@/lib/api", () => ({ api: mockApi }));

const USER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_USER_ID = "22222222-2222-4222-8222-222222222222";
const ERRAND_ID = "33333333-3333-4333-8333-333333333333";

function transaction(
  overrides: Partial<CreditTransaction> = {},
): CreditTransaction {
  return {
    transactionId: "44444444-4444-4444-8444-444444444444",
    type: "RESERVATION",
    datetime: "2026-10-17T08:00:00.000Z",
    amount: 25,
    errandId: ERRAND_ID,
    origin: { userId: USER_ID, balanceType: "CREDIT_BALANCE" },
    destination: { userId: USER_ID, balanceType: "RESERVED_BALANCE" },
    ...overrides,
  };
}

function page(overrides: Partial<CreditTransactionPage> = {}): CreditTransactionPage {
  return {
    items: [transaction()],
    total: 1,
    offset: 0,
    limit: 25,
    hasMore: false,
    ...overrides,
  };
}

function success(data: CreditTransactionPage) {
  return {
    ok: true,
    status: 200,
    data,
    code: null,
    message: null,
    replayed: false,
    etag: null,
  };
}

function failure(status = 500, code: string | null = "INTERNAL_ERROR") {
  return {
    ok: false,
    status,
    data: null,
    code,
    message: "Request failed",
    replayed: false,
    etag: null,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolver) => {
    resolve = resolver;
  });
  return { promise, resolve };
}

describe("getTransactionPresentation", () => {
  it.each([
    ["RESERVATION", transaction(), "Reserved credits", "", "text-foreground"],
    [
      "increased adjustment",
      transaction({ type: "RESERVATION_ADJUSTMENT" }),
      "Increased reservation",
      "",
      "text-foreground",
    ],
    [
      "reduced adjustment",
      transaction({
        type: "RESERVATION_ADJUSTMENT",
        origin: { userId: USER_ID, balanceType: "RESERVED_BALANCE" },
        destination: { userId: USER_ID, balanceType: "CREDIT_BALANCE" },
      }),
      "Reduced reservation",
      "",
      "text-foreground",
    ],
    [
      "incoming transfer",
      transaction({
        type: "TRANSFER",
        origin: { userId: OTHER_USER_ID, balanceType: "RESERVED_BALANCE" },
        destination: { userId: USER_ID, balanceType: "CREDIT_BALANCE" },
      }),
      "Received credits",
      "+",
      "text-success",
    ],
    [
      "outgoing transfer",
      transaction({
        type: "TRANSFER",
        origin: { userId: USER_ID, balanceType: "RESERVED_BALANCE" },
        destination: { userId: OTHER_USER_ID, balanceType: "CREDIT_BALANCE" },
      }),
      "Sent credits",
      "−",
      "text-danger",
    ],
    [
      "RELEASE",
      transaction({
        type: "RELEASE",
        origin: { userId: USER_ID, balanceType: "RESERVED_BALANCE" },
        destination: { userId: USER_ID, balanceType: "CREDIT_BALANCE" },
      }),
      "Released credits",
      "",
      "text-foreground",
    ],
  ])("maps %s from the authenticated user's perspective", (_name, item, label, prefix, amountClass) => {
    expect(getTransactionPresentation(item as CreditTransaction, USER_ID)).toEqual({
      label,
      amountPrefix: prefix,
      amountClass,
    });
  });
});

describe("CreditTransactionHistory", () => {
  beforeEach(() => {
    mockApi.mockReset();
  });

  it("loads the first 25 transactions and renders transaction details", async () => {
    const response = deferred<ReturnType<typeof success>>();
    mockApi.mockReturnValue(response.promise);

    render(<CreditTransactionHistory userId={USER_ID} />);

    expect(screen.getByRole("status")).toHaveTextContent("Loading transaction history");
    await waitFor(() =>
      expect(mockApi).toHaveBeenCalledWith(
        "GET",
        "/api/credits/transactions?offset=0&limit=25",
        { quiet: true },
      ),
    );

    response.resolve(success(page()));

    expect(await screen.findByText("Reserved credits")).toBeInTheDocument();
    expect(screen.getByText("Available → Reserved")).toBeInTheDocument();
    expect(screen.getByText("#33333333")).toBeInTheDocument();
    expect(screen.getByText(new Date("2026-10-17T08:00:00.000Z").toLocaleString())).toBeInTheDocument();
    expect(screen.getByLabelText(`Errand ${ERRAND_ID}`)).toBeInTheDocument();
  });

  it("renders transfer direction from the supplied authenticated user ID", async () => {
    mockApi.mockResolvedValue(
      success(
        page({
          items: [
            transaction({
              type: "TRANSFER",
              origin: { userId: OTHER_USER_ID, balanceType: "RESERVED_BALANCE" },
              destination: { userId: USER_ID, balanceType: "CREDIT_BALANCE" },
            }),
          ],
        }),
      ),
    );

    render(<CreditTransactionHistory userId={USER_ID} />);

    expect(await screen.findByText("Received credits")).toBeInTheDocument();
    expect(screen.getByLabelText("Received credits: +25 credits")).toHaveClass("text-success");
    expect(screen.getByLabelText(`Counterparty ${OTHER_USER_ID}`)).toHaveTextContent("From user 22222222");
  });

  it("renders an empty history", async () => {
    mockApi.mockResolvedValue(success(page({ items: [], total: 0 })));

    render(<CreditTransactionHistory userId={USER_ID} />);

    expect(await screen.findByText("No credit transactions yet.")).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Transaction history pagination" })).not.toBeInTheDocument();
  });

  it("renders the missing-account state", async () => {
    mockApi.mockResolvedValue(failure(404, "CREDIT_ACCOUNT_NOT_FOUND"));

    render(<CreditTransactionHistory userId={USER_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Your transaction history will appear after your credit account is ready.",
    );
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
  });

  it("retries a failed initial request", async () => {
    mockApi.mockResolvedValueOnce(failure()).mockResolvedValueOnce(success(page()));

    render(<CreditTransactionHistory userId={USER_ID} />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Transaction history is temporarily unavailable.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Reserved credits")).toBeInTheDocument();
    expect(mockApi).toHaveBeenCalledTimes(2);
  });

  it("uses server pagination metadata for next and previous pages", async () => {
    mockApi
      .mockResolvedValueOnce(success(page({ total: 26, hasMore: true })))
      .mockResolvedValueOnce(
        success(
          page({
            items: [transaction({ transactionId: "55555555-5555-4555-8555-555555555555" })],
            total: 26,
            offset: 25,
            hasMore: false,
          }),
        ),
      )
      .mockResolvedValueOnce(success(page({ total: 26, hasMore: true })));

    render(<CreditTransactionHistory userId={USER_ID} />);

    expect(await screen.findByText("Showing 1–1 of 26")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    expect(await screen.findByText("Showing 26–26 of 26")).toBeInTheDocument();
    expect(mockApi).toHaveBeenNthCalledWith(
      2,
      "GET",
      "/api/credits/transactions?offset=25&limit=25",
      { quiet: true },
    );
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(3));
    expect(mockApi).toHaveBeenNthCalledWith(
      3,
      "GET",
      "/api/credits/transactions?offset=0&limit=25",
      { quiet: true },
    );
  });

  it("preserves the current page while the next page loads", async () => {
    const nextPage = deferred<ReturnType<typeof success>>();
    mockApi
      .mockResolvedValueOnce(success(page({ total: 26, hasMore: true })))
      .mockReturnValueOnce(nextPage.promise);

    render(<CreditTransactionHistory userId={USER_ID} />);
    await screen.findByText("Reserved credits");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    expect(screen.getByText("Reserved credits")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Updating");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  it("ignores a stale page response after the authenticated user changes", async () => {
    const stalePage = deferred<ReturnType<typeof success>>();
    const newUserId = "66666666-6666-4666-8666-666666666666";
    mockApi
      .mockResolvedValueOnce(success(page({ total: 26, hasMore: true })))
      .mockReturnValueOnce(stalePage.promise)
      .mockResolvedValueOnce(
        success(
          page({
            items: [transaction({ amount: 99 })],
            total: 1,
          }),
        ),
      );

    const view = render(<CreditTransactionHistory userId={USER_ID} />);
    await screen.findByText("25 credits");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => expect(mockApi).toHaveBeenCalledTimes(2));

    view.rerender(<CreditTransactionHistory userId={newUserId} />);
    expect(await screen.findByText("99 credits")).toBeInTheDocument();

    await act(async () => {
      stalePage.resolve(
        success(page({ items: [transaction({ amount: 50 })], total: 1, offset: 25 })),
      );
      await stalePage.promise;
    });

    expect(screen.getByText("99 credits")).toBeInTheDocument();
    expect(screen.queryByText("50 credits")).not.toBeInTheDocument();
  });
});
