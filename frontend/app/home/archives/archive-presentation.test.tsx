import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ArchiveDetailView } from "./[archiveId]/archive-detail";
import { ArchiveList } from "./archive-list";

const mocks = vi.hoisted(() => ({ getArchives: vi.fn(), getArchive: vi.fn() }));

vi.mock("@/lib/chat/api", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/chat/api")>();
  return { ...original, getArchives: mocks.getArchives, getArchive: mocks.getArchive };
});
vi.mock("../_shell/home-shell", () => ({
  useHomeContext: () => ({ user: { uuid: "11111111-1111-4111-8111-111111111111" } }),
}));

const base = {
  chatId: "22222222-2222-4222-8222-222222222222",
  errandId: "33333333-3333-4333-8333-333333333333",
  requesterUserId: "11111111-1111-4111-8111-111111111111",
  courierUserId: "44444444-4444-4444-8444-444444444444",
};

function archive(archiveId: string, archivedAt: string) {
  return { ...base, archiveId, archivedAt };
}

describe("archive presentation", () => {
  beforeEach(() => {
    mocks.getArchives.mockReset();
    mocks.getArchive.mockReset();
  });

  it("appends newest-first cursor pages without duplicating archives", async () => {
    const newest = archive("55555555-5555-4555-8555-555555555555", "2026-01-02T00:00:00.000Z");
    const older = archive("66666666-6666-4666-8666-666666666666", "2026-01-01T00:00:00.000Z");
    mocks.getArchives
      .mockResolvedValueOnce({ items: [newest], hasMore: true, nextCursor: "older" })
      .mockResolvedValueOnce({ items: [newest, older], hasMore: false, nextCursor: null });
    render(<ArchiveList />);
    await screen.findByText(/Errand 33333333/);
    await userEvent.click(screen.getByRole("button", { name: "Load more archives" }));
    await waitFor(() => expect(screen.getAllByRole("listitem")).toHaveLength(2));
    expect(
      screen.getAllByRole("link").map((link) => link.getAttribute("href")).filter((href) => href?.startsWith("/home/archives/")),
    ).toEqual([
      `/home/archives/${newest.archiveId}`,
      `/home/archives/${older.archiveId}`,
    ]);
  });

  it("renders archive content as inert text with no mutation controls", async () => {
    const malicious = '<img src=x onerror="alert(1)">';
    mocks.getArchive.mockResolvedValue({
      ...archive("55555555-5555-4555-8555-555555555555", "2026-01-02T00:00:00.000Z"),
      schemaVersion: 1,
      messages: [{ role: "COURIER", content: malicious, timestamp: "2026-01-01T00:00:00.000Z" }],
    });
    const { container } = render(<ArchiveDetailView archiveId="55555555-5555-4555-8555-555555555555" />);
    expect(await screen.findByText(malicious)).toBeVisible();
    expect(container.querySelector("img")).toBeNull();
    expect(screen.queryByRole("button", { name: /send|edit|delete|restore/i })).not.toBeInTheDocument();
  });
});
