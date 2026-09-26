# .github/scripts/review.py
import os
import subprocess
import sys
import time
import requests

AGENT_API_URL = os.environ["AGENT_API_URL"].rstrip("/")
AGENT_API_KEY = os.environ["AGENT_API_KEY"]
AGENT_MODEL = os.environ.get("AGENT_MODEL", "qwen3-coder-next")
GH_TOKEN = os.environ["GH_TOKEN"]
REPO = os.environ["REPO"]
PR_NUMBER = os.environ["PR_NUMBER"]
BASE_SHA = os.environ["BASE_SHA"]
HEAD_SHA = os.environ["HEAD_SHA"]

# qwen3-coder-next has a 196608 token context window (~4 chars/token is a safe
# estimate for code). Leave headroom for system prompt + output tokens.
MAX_TOTAL_CHARS = 140000
MAX_FILE_CHARS = 20000

SKIP_EXTENSIONS = {
    ".lock", ".png", ".jpg", ".jpeg", ".gif", ".svg", ".ico", ".pdf", ".zip",
    ".woff", ".woff2", ".ttf", ".map",
}
SKIP_PATHS = {"package-lock.json", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "Cargo.lock"}
SKIP_DIRS = {"node_modules/", "dist/", "build/", ".next/", "vendor/"}


def get_changed_files_with_stats():
    """Return list of (path, insertions, deletions), largest changes first."""
    out = subprocess.run(
        ["git", "diff", "--numstat", f"{BASE_SHA}...{HEAD_SHA}"],
        capture_output=True, text=True, check=True
    ).stdout
    files = []
    for line in out.strip().splitlines():
        parts = line.split("\t")
        if len(parts) != 3:
            continue
        ins, dels, path = parts
        if any(path.startswith(d) for d in SKIP_DIRS):
            continue
        if any(path.endswith(ext) for ext in SKIP_EXTENSIONS):
            continue
        if os.path.basename(path) in SKIP_PATHS:
            continue
        try:
            total_change = int(ins) + int(dels)
        except ValueError:
            total_change = 0  # binary file, numstat gives "-"
        files.append((path, total_change))
    # prioritize files with the most churn, so if we hit the budget cap
    # we truncate the least-changed files first, not alphabetically
    files.sort(key=lambda f: f[1], reverse=True)
    return [f[0] for f in files]


def get_diff_for_file(path):
    """Small, cheap: just the diff hunk for this file, used as review anchor."""
    out = subprocess.run(
        ["git", "diff", f"{BASE_SHA}...{HEAD_SHA}", "--", path],
        capture_output=True, text=True, check=True
    ).stdout
    return out


def read_file_at_head(path):
    try:
        content = subprocess.run(
            ["git", "show", f"{HEAD_SHA}:{path}"],
            capture_output=True, text=True, check=True
        ).stdout
    except subprocess.CalledProcessError:
        return None
    if len(content) > MAX_FILE_CHARS:
        content = content[:MAX_FILE_CHARS] + "\n...[truncated]"
    return content


def build_payload(files):
    """
    Efficient hybrid: send the diff (cheap, shows intent) plus full file
    content only for files small enough to fit the remaining budget.
    Large files fall back to diff-only, still useful, far fewer tokens.
    """
    blocks = []
    total = 0
    diff_only = []

    for path in files:
        diff = get_diff_for_file(path)
        if not diff.strip():
            continue

        full = read_file_at_head(path)
        candidate = full if full is not None else ""

        cost = len(diff) + len(candidate)
        if total + cost <= MAX_TOTAL_CHARS:
            total += cost
            blocks.append(f"### File: {path}\n**Diff:**\n```diff\n{diff}\n```\n**Full file (current):**\n```\n{candidate}\n```")
        elif total + len(diff) <= MAX_TOTAL_CHARS:
            total += len(diff)
            blocks.append(f"### File: {path}\n**Diff only (full file skipped for budget):**\n```diff\n{diff}\n```")
            diff_only.append(path)
        else:
            diff_only.append(path)  # skipped entirely

    return "\n\n".join(blocks), diff_only


def call_agent(files_text, retries=3):
    url = f"{AGENT_API_URL}/chat/completions"
    headers = {
        "Authorization": f"Bearer {AGENT_API_KEY}",
        "Content-Type": "application/json",
    }
    payload = {
        "model": AGENT_MODEL,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are a senior software engineer reviewing a pull request. "
                    "For each file you get the diff and, when available, the full current "
                    "file for context. Focus on bugs, security issues, and missing tests. "
                    "Be concise, use Markdown, group feedback by file. "
                    "If everything looks fine, say so briefly instead of padding the review."
                ),
            },
            {"role": "user", "content": f"Review this pull request:\n\n{files_text}"},
        ],
        "max_tokens": 1200,
        "temperature": 0.2,
    }

    for attempt in range(retries):
        resp = requests.post(url, headers=headers, json=payload, timeout=180)
        if resp.status_code == 429:
            wait = 5 * (attempt + 1)
            print(f"Rate/budget limited, retrying in {wait}s...", file=sys.stderr)
            time.sleep(wait)
            continue
        if resp.status_code == 401:
            raise RuntimeError(f"Auth failed: {resp.json().get('error')}")
        if resp.status_code == 403:
            raise RuntimeError(f"Model/policy denied: {resp.json().get('error')}")
        resp.raise_for_status()
        return resp.json()["choices"][0]["message"]["content"]

    raise RuntimeError("Exhausted retries on 429 (rate limit or budget limit)")


def post_comment(body):
    url = f"https://api.github.com/repos/{REPO}/issues/{PR_NUMBER}/comments"
    headers = {
        "Authorization": f"Bearer {GH_TOKEN}",
        "Accept": "application/vnd.github+json",
    }
    resp = requests.post(url, headers=headers, json={"body": body})
    resp.raise_for_status()


def main():
    files = get_changed_files_with_stats()
    if not files:
        return

    files_text, diff_only = build_payload(files)
    if not files_text.strip():
        return

    try:
        review = call_agent(files_text)
    except Exception as e:
        post_comment(f"## 🤖 AI PR Review\n\n⚠️ Review failed: {e}")
        raise

    comment = f"## 🤖 AI PR Review\n\n{review}"
    if diff_only:
        comment += f"\n\n_Reviewed via diff only (full file too large for budget): {', '.join(diff_only)}_"

    post_comment(comment)


if __name__ == "__main__":
    main()