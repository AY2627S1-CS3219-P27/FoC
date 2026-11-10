import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { BuildingsPanel } from "./buildings-panel";
import type { BuildingItem } from "../_shared/types";

const mocks = vi.hoisted(() => ({ api: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: mocks.api };
});
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));
// Leaflet needs a browser layout; the picker is just a button in tests.
vi.mock("../_errands/campus-map", () => ({
  default: ({
    onChange,
  }: {
    value: { latitude: number; longitude: number } | null;
    onChange: (at: { latitude: number; longitude: number }) => void;
  }) => (
    <button type="button" onClick={() => onChange({ latitude: 1.2966, longitude: 103.7764 })}>
      Drop pin
    </button>
  ),
}));

const boundary = {
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      properties: {},
      geometry: {
        type: "Polygon",
        coordinates: [
          [
            [103.7715, 1.29],
            [103.779, 1.29],
            [103.779, 1.306],
            [103.7715, 1.306],
            [103.7715, 1.29],
          ],
        ],
      },
    },
  ],
};

const buildings: BuildingItem[] = [
  {
    id: "b1",
    canonicalName: "Computing 3",
    shortName: "COM3",
    coordinates: { latitude: 1.2966, longitude: 103.7764 },
    venueCount: 4,
    allowsPin: false,
  },
];

const ok = () => ({ ok: true, status: 201, data: {}, code: null, message: null, etag: null });
const refused = (status: number, message: string) => ({
  ok: false,
  status,
  data: null,
  code: "X",
  message,
  etag: null,
});

function setup() {
  const onChanged = vi.fn();
  const view = render(<BuildingsPanel buildings={buildings} onChanged={onChanged} />);
  return { onChanged, user: userEvent.setup(), ...view };
}

const name = () => screen.getByLabelText(/^Name/);
const shortName = () => screen.getByLabelText(/^Short name/);
const aliases = () => screen.getByLabelText(/^Also known as/);
const add = () => screen.getByRole("button", { name: "Add building" });
const postCall = () => mocks.api.mock.calls.find((c) => c[0] === "POST");

describe("BuildingsPanel", () => {
  beforeEach(() => {
    mocks.api.mockReset();
    mocks.api.mockImplementation((method: string, path: string) =>
      path === "/api/campus-boundary"
        ? Promise.resolve({ ok: true, status: 200, data: boundary, code: null, message: null, etag: null })
        : Promise.resolve(ok()),
    );
  });

  it("lists the existing buildings", async () => {
    setup();
    expect(screen.getByText("COM3")).toBeInTheDocument();
    expect(screen.getByText("Computing 3")).toBeInTheDocument();
    expect(screen.getByText("4 venues")).toBeInTheDocument();
    await screen.findByRole("button", { name: "Drop pin" });
  });

  it("keeps Add disabled until both names and the map pin are set", async () => {
    const { user: ui } = setup();
    await screen.findByRole("button", { name: "Drop pin" });
    expect(add()).toBeDisabled();

    await ui.type(name(), "Computing 3");
    await ui.type(shortName(), "COM3");
    expect(add()).toBeDisabled();

    await ui.click(screen.getByRole("button", { name: "Drop pin" }));
    expect(add()).toBeEnabled();
  });

  it("creates the building with its coordinates and then refreshes", async () => {
    const { user: ui, onChanged } = setup();
    await screen.findByRole("button", { name: "Drop pin" });
    await ui.type(name(), "Computing 3");
    await ui.type(shortName(), "COM3");
    await ui.click(screen.getByRole("button", { name: "Drop pin" }));
    await ui.click(add());

    expect(postCall()?.[2]).toMatchObject({
      body: {
        canonicalName: "Computing 3",
        shortName: "COM3",
        coordinates: { latitude: 1.2966, longitude: 103.7764 },
      },
      idempotencyKey: expect.any(String),
    });
    expect(postCall()?.[2].body).not.toHaveProperty("aliases");
    expect(mocks.success).toHaveBeenCalledWith("Added “Computing 3”");
    expect(onChanged).toHaveBeenCalled();
  });

  it("splits comma-separated aliases into a list", async () => {
    const { user: ui } = setup();
    await screen.findByRole("button", { name: "Drop pin" });
    await ui.type(name(), "Computing 3");
    await ui.type(shortName(), "COM3");
    await ui.type(aliases(), "Computing 3, COM 3");
    await ui.click(screen.getByRole("button", { name: "Drop pin" }));
    await ui.click(add());

    expect(postCall()?.[2].body).toEqual({
      canonicalName: "Computing 3",
      shortName: "COM3",
      aliases: ["Computing 3", "COM 3"],
      coordinates: { latitude: 1.2966, longitude: 103.7764 },
    });
  });

  it("shows the server's refusal and stays open", async () => {
    mocks.api.mockImplementation((method: string, path: string) =>
      path === "/api/campus-boundary"
        ? Promise.resolve({ ok: true, status: 200, data: boundary, code: null, message: null, etag: null })
        : Promise.resolve(refused(409, "A building already uses that name.")),
    );
    const { user: ui, onChanged } = setup();
    await screen.findByRole("button", { name: "Drop pin" });
    await ui.type(name(), "Computing 3");
    await ui.type(shortName(), "COM3");
    await ui.click(screen.getByRole("button", { name: "Drop pin" }));
    await ui.click(add());

    expect(await screen.findByRole("alert")).toHaveTextContent("already uses that name");
    expect(onChanged).not.toHaveBeenCalled();
  });
});
