import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditErrandForm } from "./edit-errand-form";
import type { BuildingOption, Errand, SupplierOption } from "./types";

const mocks = vi.hoisted(() => ({ api: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: mocks.api };
});
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
// The real combobox is a popup; a select drives the same props.
vi.mock("@/components/ui/combobox", () => ({
  OptionCombobox: ({
    options,
    value,
    onValueChange,
  }: {
    options: { value: string; label: string }[];
    value: string;
    onValueChange: (v: string) => void;
  }) => (
    <select value={value} onChange={(e) => onValueChange(e.target.value)}>
      <option value="" />
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  ),
}));

const errand: Errand = {
  id: "e1",
  status: "Open",
  supplierId: "s1",
  pickupName: "Cool Spot",
  pickupLocation: "COM2",
  pickupDescription: null,
  deliveryLocation: "COM2",
  deliveryDetail: "Level 3",
  deliveryVenue: null,
  deliveryLatitude: null,
  deliveryLongitude: null,
  collectionItems: "tea",
  description: null,
  rewardCredits: 5,
  expiresAt: null,
  createdAt: "2030-01-01T00:00:00.000Z",
};
const suppliers: SupplierOption[] = [
  { id: "s1", displayName: "Cool Spot", building: null, floor: "1" },
  { id: "s2", displayName: "Hot Spot", building: null, floor: "2" },
];
const place = { coordinates: { latitude: 1.29, longitude: 103.77 }, venueCount: 0 };
const buildings: BuildingOption[] = [
  { id: "b1", shortName: "COM2", canonicalName: "Computing 2", ...place },
  { id: "b2", shortName: "AS6", canonicalName: "Arts 6", ...place },
  { id: "b3", shortName: "PIN", canonicalName: "Other (map pin)", allowsPin: true, ...place },
];

const ok = { ok: true, status: 200, data: { sequenceNumber: 4 }, code: null, message: null, etag: null };
const refused = (status: number, message: string) => ({ ok: false, status, data: null, code: "X", message, etag: null });

function setup(over: Partial<Errand> = {}) {
  const onSaved = vi.fn();
  const view = render(
    <EditErrandForm errand={{ ...errand, ...over }} userId="u1" suppliers={suppliers} buildings={buildings} onSaved={onSaved} />,
  );
  return { onSaved, user: userEvent.setup(), ...view };
}
const save = () => screen.getByRole("button", { name: "Save changes" });
const items = () => screen.getByLabelText("Items to collect");

describe("EditErrandForm", () => {
  beforeEach(() => mocks.api.mockReset());

  it("starts with Save disabled and the current values filled in", () => {
    setup();
    expect(save()).toBeDisabled();
    expect(items()).toHaveValue("tea");
    expect(screen.getByLabelText("Pickup from")).toHaveValue("s1");
    expect(screen.getByLabelText(/Deliver to/)).toHaveValue("b1");
    expect(screen.getByLabelText(/Credits offered/)).toHaveValue(5);
  });

  it("does not offer the map pin placeholder", () => {
    setup();
    expect(screen.queryByRole("option", { name: /map pin/ })).not.toBeInTheDocument();
  });

  it("sends only what changed, with an idempotency key, then reports it saved", async () => {
    mocks.api.mockResolvedValue(ok);
    const { user, onSaved } = setup();
    await user.type(items(), " and milo");
    await user.click(save());

    expect(mocks.api).toHaveBeenCalledWith("PATCH", "/api/errands/e1", {
      idempotencyKey: expect.any(String),
      body: { collectionItems: "tea and milo" },
    });
    expect(mocks.success).toHaveBeenCalledWith("Errand updated", undefined);
    expect(onSaved).toHaveBeenCalledOnce();
  });

  it("says a supplier change is only being checked", async () => {
    mocks.api.mockResolvedValue(ok);
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText("Pickup from"), "s2");
    await user.click(save());

    expect(mocks.api.mock.calls[0][2].body).toEqual({ supplierId: "s2" });
    expect(mocks.success).toHaveBeenCalledWith("Checking your change", {
      description: expect.stringContaining("stays as it was"),
    });
  });

  it("warns that a new building removes a venue or pin", async () => {
    const { user } = setup();
    expect(screen.queryByText(/removes any venue or pin/)).not.toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText(/Deliver to/), "b2");
    expect(screen.getByText(/removes any venue or pin/)).toBeInTheDocument();
  });

  // The credit check answers for the raise only: 5 -> 9 asks about 4 more.
  const sufficiency = (sufficient: boolean) =>
    mocks.api.mockResolvedValue({ ...ok, data: { userId: "u1", amount: 4, sufficient } });
  const raiseTo9 = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.clear(screen.getByLabelText(/Credits offered/));
    await user.type(screen.getByLabelText(/Credits offered/), "9");
  };

  it("allows a reward and supplier change together", async () => {
    sufficiency(true);
    const { user } = setup();
    await user.selectOptions(screen.getByLabelText("Pickup from"), "s2");
    await raiseTo9(user);
    expect(await screen.findByText(/4 extra credits available/)).toBeInTheDocument();
    expect(screen.queryByText(/separate edits/)).not.toBeInTheDocument();
    expect(save()).toBeEnabled();
    expect(mocks.api).toHaveBeenCalledWith("POST", "/api/credits/sufficiency", { body: { userId: "u1", amount: 4 } });
  });

  it("blocks Save when the raise is more than the available credits", async () => {
    sufficiency(false);
    const { user } = setup();
    await raiseTo9(user);
    expect(await screen.findByText(/do not have 4 more credits/)).toBeInTheDocument();
    expect(save()).toBeDisabled();
  });

  it("keeps Save available when the credit check fails; the server refuses on save instead", async () => {
    const unreachable = { ok: false, status: 503, data: null, code: null, message: null, etag: null };
    mocks.api.mockImplementation((_method: string, path: string) =>
      Promise.resolve(path === "/api/credits/sufficiency" ? unreachable : ok),
    );
    const { user } = setup();
    await raiseTo9(user);
    expect(await screen.findByText(/confirm the amount when you save/)).toBeInTheDocument();
    expect(save()).toBeEnabled();
    await user.click(save());

    expect(mocks.api).toHaveBeenCalledWith("PATCH", "/api/errands/e1", {
      idempotencyKey: expect.any(String),
      body: { rewardCredits: 9 },
    });
  });

  it("does not check credits for a lower reward", async () => {
    const { user } = setup();
    await user.clear(screen.getByLabelText(/Credits offered/));
    await user.type(screen.getByLabelText(/Credits offered/), "3");
    expect(save()).toBeEnabled();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("shows the server's refusal and stays open", async () => {
    mocks.api.mockResolvedValue(refused(409, "Only an Open errand can be edited."));
    const { user, onSaved } = setup();
    await user.type(items(), "!");
    await user.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent("Only an Open errand can be edited.");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("keeps the key after a network failure, and takes a new one after a refusal", async () => {
    mocks.api.mockResolvedValueOnce(refused(0, "x"));
    mocks.api.mockResolvedValueOnce(refused(409, "Refresh and try again."));
    mocks.api.mockResolvedValueOnce(ok);
    const { user } = setup();
    await user.type(items(), "!");
    await user.click(save());
    await waitFor(() => expect(save()).toBeEnabled());
    await user.click(save());
    await screen.findByText("Refresh and try again.");
    await user.click(save());

    const keys = mocks.api.mock.calls.map((c) => c[2].idempotencyKey);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("keeps what is being typed when polling brings a newer errand", async () => {
    const { user, rerender } = setup();
    await user.type(items(), " and milo");
    rerender(
      <EditErrandForm errand={{ ...errand, collectionItems: "polled" }} userId="u1" suppliers={suppliers} buildings={buildings} onSaved={vi.fn()} />,
    );
    expect(items()).toHaveValue("tea and milo");
  });
});
