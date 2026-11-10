import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EditUserForm } from "./edit-user-form";
import type { UserListItem } from "../_shared/types";

const mocks = vi.hoisted(() => ({ api: vi.fn(), success: vi.fn() }));

vi.mock("@/lib/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/api")>();
  return { ...original, api: mocks.api };
});
vi.mock("sonner", () => ({ toast: { success: mocks.success } }));

const user: UserListItem = {
  uuid: "u1",
  email: "eve@u.nus.edu",
  displayName: "Eve Tan",
  roles: ["requester"],
  profilePictureUrl: null,
  isAdmin: false,
};

const ok = (data: UserListItem = { ...user }) => ({
  ok: true,
  status: 200,
  data,
  code: null,
  message: null,
  etag: null,
});
const refused = (status: number, message: string) => ({
  ok: false,
  status,
  data: null,
  code: "X",
  message,
  etag: null,
});

function setup(over: Partial<UserListItem> = {}) {
  const onSaved = vi.fn();
  const view = render(
    <EditUserForm
      user={{ ...user, ...over }}
      onSaved={onSaved}
      onCancel={vi.fn()}
    />,
  );
  return { onSaved, user: userEvent.setup(), ...view };
}

const email = () => screen.getByLabelText(/^Email/);
const name = () => screen.getByLabelText("Display name");
const picture = () => screen.getByLabelText(/^Profile picture URL/);
const save = () => screen.getByRole("button", { name: "Save changes" });

describe("EditUserForm", () => {
  beforeEach(() => mocks.api.mockReset());

  it("starts with Save disabled and the current values filled in", () => {
    setup();
    expect(email()).toHaveValue("eve@u.nus.edu");
    expect(name()).toHaveValue("Eve Tan");
    expect(picture()).toHaveValue("");
    expect(save()).toBeDisabled();
  });

  it("sends only what changed", async () => {
    mocks.api.mockResolvedValue(ok({ ...user, displayName: "Eve Newman" }));
    const { user: ui, onSaved } = setup();
    await ui.clear(name());
    await ui.type(name(), "Eve Newman");
    await ui.click(save());

    expect(mocks.api).toHaveBeenCalledWith("PATCH", "/api/users/u1", {
      body: { displayName: "Eve Newman" },
    });
    expect(mocks.success).toHaveBeenCalledWith("User updated");
    expect(onSaved).toHaveBeenCalledWith({
      ...user,
      displayName: "Eve Newman",
    });
  });

  it("asks before an email change, since it locks the account", async () => {
    mocks.api.mockResolvedValue(ok({ ...user, email: "eve.new@nus.edu.sg" }));
    const { user: ui } = setup();
    await ui.clear(email());
    await ui.type(email(), "Eve.New@NUS.edu.sg");
    await ui.click(save());

    // Nothing is sent until the admin confirms.
    expect(mocks.api).not.toHaveBeenCalled();
    expect(screen.getByText("Change this user's email?")).toBeInTheDocument();
    expect(
      screen.getByText(/locked out until they set a new password/),
    ).toBeInTheDocument();

    await ui.click(screen.getByRole("button", { name: "Change email" }));
    expect(mocks.api).toHaveBeenCalledWith("PATCH", "/api/users/u1", {
      body: { email: "eve.new@nus.edu.sg" },
    });
  });

  it("clears the picture when the URL is emptied", async () => {
    mocks.api.mockResolvedValue(ok({ ...user, profilePictureUrl: null }));
    const { user: ui } = setup({
      profilePictureUrl: "https://example.com/eve.png",
    });
    await ui.clear(picture());
    await ui.click(save());

    expect(mocks.api.mock.calls[0][2].body).toEqual({
      profilePictureUrl: null,
    });
  });

  it("set-replaces the roles", async () => {
    mocks.api.mockResolvedValue(
      ok({ ...user, roles: ["requester", "courier"] }),
    );
    const { user: ui } = setup();
    await ui.click(screen.getByRole("switch", { name: "courier" }));
    await ui.click(save());

    expect(mocks.api.mock.calls[0][2].body).toEqual({
      roles: ["requester", "courier"],
    });
  });

  it("shows the server's refusal and keeps the form open", async () => {
    mocks.api.mockResolvedValue(
      refused(
        409,
        "You can't turn off a role while you still have ongoing errands in it.",
      ),
    );
    const { user: ui, onSaved } = setup();
    await ui.click(screen.getByRole("switch", { name: "requester" }));
    await ui.click(save());

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "ongoing errands",
    );
    expect(onSaved).not.toHaveBeenCalled();
  });
});
