import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiResult } from "@/lib/api";
import { HelpChat } from "./help-chat";

const mocks = vi.hoisted(() => ({ api: vi.fn() }));

vi.mock("@/lib/api", async (importActual) => ({
  ...(await importActual<typeof import("@/lib/api")>()),
  api: mocks.api,
}));

function success(data: unknown): ApiResult {
  return { ok: true, status: 200, data, code: null, message: null, etag: null };
}

function failure(status: number): ApiResult {
  return { ok: false, status, data: null, code: null, message: null, etag: null };
}

const answered = {
  answer: "Credits are FoC's own points.",
  answered: true,
  sources: [{ title: "Credits", section: "What are FoC credits?" }],
};

const composer = () => screen.getByLabelText("Your question");
const send = () => screen.getByRole("button", { name: "Send" });

describe("HelpChat", () => {
  beforeEach(() => {
    mocks.api.mockReset();
  });

  it("introduces the bot without calling the backend", () => {
    render(<HelpChat />);

    expect(screen.getByText(/I'm the FoC help bot/)).toBeInTheDocument();
    expect(screen.getByText(/don't include passwords/)).toBeInTheDocument();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("shows the question and a waiting bubble, then the answer and its sources", async () => {
    let resolve: (value: ApiResult) => void = () => {};
    mocks.api.mockReturnValue(new Promise((r) => (resolve = r)));
    const user = userEvent.setup();
    render(<HelpChat />);

    await user.type(composer(), "  How do credits work?  {Enter}");

    expect(screen.getByText("How do credits work?")).toBeInTheDocument();
    expect(screen.getByText(/Looking through the help documents/)).toBeInTheDocument();
    expect(composer()).toHaveValue("");
    expect(mocks.api).toHaveBeenCalledWith("POST", "/api/assistant/questions", { body: { question: "How do credits work?" } });

    resolve(success(answered));

    expect(await screen.findByText("Credits are FoC's own points.")).toBeInTheDocument();
    expect(screen.getByText("📚 Source: Credits · What are FoC credits?")).toBeInTheDocument();
    expect(screen.queryByText(/Looking through the help documents/)).not.toBeInTheDocument();
  });

  it("shows a could-not-answer reply as a normal message with no sources", async () => {
    mocks.api.mockResolvedValue(success({ answer: "I couldn't find that.", answered: false, sources: [] }));
    const user = userEvent.setup();
    render(<HelpChat />);

    await user.type(composer(), "What's the weather?{Enter}");

    expect(await screen.findByText("I couldn't find that.")).toBeInTheDocument();
    expect(screen.queryByText(/Sources?:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Couldn't get an answer/)).not.toBeInTheDocument();
  });

  it("renders **bold** in an answer and leaves everything else as plain text", async () => {
    mocks.api.mockResolvedValue(
      success({
        answer: "- **Supplier:** where to collect\n<img src=x onerror=alert(1)> and a stray ** marker",
        answered: true,
        sources: [],
      }),
    );
    const user = userEvent.setup();
    const { container } = render(<HelpChat />);

    await user.type(composer(), "What goes on an errand?{Enter}");

    const bold = await screen.findByText("Supplier:");
    expect(bold.tagName).toBe("STRONG");
    expect(container.querySelector("img")).toBeNull();
    expect(bold.parentElement).toHaveTextContent("<img src=x onerror=alert(1)> and a stray ** marker");
    expect(bold.parentElement).not.toHaveTextContent("**Supplier");
  });

  it("shows `code` without its backticks and leaves everything else as plain text", async () => {
    mocks.api.mockResolvedValue(
      success({ answer: "Use `@u.nus.edu` or **your** `<b>` address, not a stray ` mark", answered: true, sources: [] }),
    );
    const user = userEvent.setup();
    const { container } = render(<HelpChat />);

    await user.type(composer(), "Which email?{Enter}");

    const code = await screen.findByText("@u.nus.edu");
    expect(code.tagName).toBe("CODE");
    expect(screen.getByText("your").tagName).toBe("STRONG");
    expect(screen.getByText("<b>").tagName).toBe("CODE");
    expect(container.querySelector("b")).toBeNull();
    expect(code.parentElement).toHaveTextContent("Use @u.nus.edu or your <b> address, not a stray ` mark");
  });

  it("offers Retry after a failure and re-sends the same question", async () => {
    mocks.api.mockResolvedValueOnce(failure(429)).mockResolvedValueOnce(success(answered));
    const user = userEvent.setup();
    render(<HelpChat />);

    await user.type(composer(), "How do credits work?{Enter}");

    expect(await screen.findByText(/Couldn't get an answer\. Too many attempts/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Retry" }));

    expect(await screen.findByText("Credits are FoC's own points.")).toBeInTheDocument();
    expect(screen.queryByText(/Couldn't get an answer/)).not.toBeInTheDocument();
    expect(screen.getAllByText("How do credits work?")).toHaveLength(1);
    expect(mocks.api).toHaveBeenCalledTimes(2);
    expect(mocks.api.mock.calls[1]?.[2]).toEqual({ body: { question: "How do credits work?" } });
  });

  it("does not send a second question while one is waiting", async () => {
    mocks.api.mockReturnValue(new Promise(() => {}));
    const user = userEvent.setup();
    render(<HelpChat />);

    await user.type(composer(), "First{Enter}");
    await user.type(composer(), "Second{Enter}");

    expect(composer()).toHaveValue("Second");
    expect(send()).toBeDisabled();
    expect(mocks.api).toHaveBeenCalledTimes(1);
  });

  it("enforces the 500-character limit and shows the counter from 400", () => {
    render(<HelpChat />);

    fireEvent.change(composer(), { target: { value: "a".repeat(399) } });
    expect(screen.queryByText("399 / 500")).not.toBeInTheDocument();
    expect(send()).toBeEnabled();

    fireEvent.change(composer(), { target: { value: "a".repeat(500) } });
    expect(screen.getByText("500 / 500")).toBeInTheDocument();
    expect(send()).toBeEnabled();

    fireEvent.change(composer(), { target: { value: "a".repeat(501) } });
    expect(screen.getByText("501 / 500")).toBeInTheDocument();
    expect(send()).toBeDisabled();
  });

  it("does not send a blank question", async () => {
    const user = userEvent.setup();
    render(<HelpChat />);

    await user.type(composer(), "   {Enter}");

    expect(send()).toBeDisabled();
    expect(mocks.api).not.toHaveBeenCalled();
  });

  it("adds a line on Shift+Enter instead of sending", async () => {
    const user = userEvent.setup();
    render(<HelpChat />);

    await user.type(composer(), "one{Shift>}{Enter}{/Shift}two");

    expect(composer()).toHaveValue("one\ntwo");
    expect(mocks.api).not.toHaveBeenCalled();
    await waitFor(() => expect(send()).toBeEnabled());
  });
});
