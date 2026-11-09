import { expect, test } from "@playwright/test";

const requesterState = process.env.PLAYWRIGHT_REQUESTER_STORAGE_STATE;
const courierState = process.env.PLAYWRIGHT_COURIER_STORAGE_STATE;
const chatId = process.env.PLAYWRIGHT_CHAT_ID;
const archiveId = process.env.PLAYWRIGHT_ARCHIVE_ID;
const configured = Boolean(requesterState && courierState && chatId);

test.describe("real-ingress two-user chat", () => {
  test.skip(!configured, "Set both storage-state paths and PLAYWRIGHT_CHAT_ID to run against the live stack.");

  test("sends through public ingress and delivers to an isolated participant context", async ({ browser }) => {
    const requesterContext = await browser.newContext({ storageState: requesterState });
    const courierContext = await browser.newContext({ storageState: courierState });
    const requester = await requesterContext.newPage();
    const courier = await courierContext.newPage();
    const content = `Playwright ${Date.now()}`;

    await Promise.all([
      requester.goto(`/home/chats/${chatId}`),
      courier.goto(`/home/chats/${chatId}`),
    ]);
    await expect(requester.getByText("Connected", { exact: true })).toBeVisible();
    await expect(courier.getByText("Connected", { exact: true })).toBeVisible();

    await requester.getByRole("textbox", { name: "Message" }).fill(content);
    await requester.getByRole("textbox", { name: "Message" }).press("Enter");
    await expect(requester.getByText(content, { exact: true })).toBeVisible();
    await expect(courier.getByText(content, { exact: true })).toBeVisible();
    await expect(requester.getByText("Read", { exact: true })).toBeVisible();

    await requesterContext.close();
    await courierContext.close();
  });

  test("renders an optional archive through the immutable public route", async ({ browser }) => {
    test.skip(!archiveId, "Set PLAYWRIGHT_ARCHIVE_ID to include immutable archive verification.");
    const context = await browser.newContext({ storageState: requesterState });
    const page = await context.newPage();
    await page.goto(`/home/archives/${archiveId}`);
    await expect(page.getByRole("heading", { name: "Archived errand chat" })).toBeVisible();
    await expect(page.getByText(/immutable snapshot/i)).toBeVisible();
    await expect(page.getByRole("button", { name: /send|edit|delete|restore/i })).toHaveCount(0);
    await context.close();
  });
});
