import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SupplierForm } from "./supplier-form";

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: vi.fn() };
});

const props = {
  buildings: [],
  categories: [{ id: "c1", name: "Food" }],
  onDone: vi.fn(),
};

describe("SupplierForm photo URL", () => {
  it("is offered to admins creating a supplier", () => {
    render(<SupplierForm mode="admin-create" {...props} />);
    expect(screen.getByText("Photo URL (optional)")).toBeTruthy();
  });

  it("is not offered when a basic user suggests a new supplier", () => {
    render(<SupplierForm mode="request-create" {...props} />);
    expect(screen.queryByText("Photo URL (optional)")).toBeNull();
  });
});
