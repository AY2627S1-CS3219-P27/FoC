import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { SupplierForm, type SupplierFormMode } from "./supplier-form";

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
  it.each<SupplierFormMode>(["admin-create", "request-create"])("is not offered in %s mode", (mode) => {
    render(<SupplierForm mode={mode} {...props} />);
    expect(screen.queryByText("Photo URL (optional)")).toBeNull();
  });
});
