This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Backend and realtime routing

The browser reaches backend services only through this Next.js server. Chat
HTTP requests use `/api/chats/*`, while Socket.IO uses the configured
`SOCKET_PATH` (default `/socket.io`) and selects the `/chat` namespace after
the WebSocket connection is established. Both routes are rewritten to private
Communication Service through `COMMS_SERVICE_URL`.

The frontend custom server explicitly forwards `Upgrade` requests on the
configured socket path to Communication Service and delegates other upgrades,
including development HMR, to Next.js. The Socket.IO client must use WebSocket transport only and rely on the
HTTP-only same-site `access_token` cookie; do not place the token in JavaScript
storage, query parameters, auth payloads, or socket events. The rewrite must
preserve cookies, query parameters, `Origin`, `Upgrade`, and `Connection`.
Next.js external rewrites provide this behavior locally. Production ingress
must preserve the same contract and route the complete socket path, including
subpaths, without exposing Communication Service directly.

For the root Compose stack, the public browser origin is
`http://localhost:3001`, `COMMS_SERVICE_URL` is
`http://comms-service:3000`, and both frontend and Communication Service must
use the same `SOCKET_PATH` value.

## Authenticated home shell

All `/home` routes share one persistent layout. Its client boundary loads the
current user once, owns the session-expiry redirect, and provides the profile
and socket path to live-chat and archive descendants. The server layout reads
`SOCKET_PATH` during dynamic request rendering and passes it as serialized
configuration, so the browser receives no token and no additional
`NEXT_PUBLIC_*` environment variable is required.

The shared responsive navigation exposes Home, Chats, and Archives. The
existing errands, suppliers, account, user, and supplier-request tabs remain
secondary navigation within `/home`; administrator-only tabs retain their
existing authorization-driven visibility.

Communication Service HTTP and Socket.IO payloads must pass the runtime parsers
under `lib/chat/` before entering frontend state. Unknown fields, invalid IDs or
timestamps, inconsistent grace state, malformed pagination, non-ascending
history, and invalid acknowledgement/event shapes are rejected as contract
failures rather than accepted through unchecked casts.

`/home/chats` lists active and grace-period conversations newest first, with
cursor pagination, unread state, and last-message summaries. Opening
`/home/chats/[chatId]` creates one route-scoped `/chat` socket, loads the latest
history window, and joins the authorized room. Reconnect synchronization
buffers realtime events, refetches authoritative history, pages backward until
it overlaps the mounted transcript, and then merges by both message ID and
sequence. Pending sends stay outside the committed transcript and retain their
`clientMessageId` when explicitly retried. Read commands run only after render;
receipt labels are shown only on the authenticated caller's sent messages.

`/home/archives` lists the caller's own archived chats newest first
(`archivedAt DESC, archiveId DESC`), appending server-provided cursor pages
without client-side reordering. `/home/archives/[archiveId]` renders one
immutable snapshot's role-labelled messages in order through plain React text
interpolation; it exposes no composer, socket, or mutation control, and an
absent or unauthorized archive renders the same not-found presentation as any
other archive ID.

## Verification

Run the deterministic frontend suites without a backend stack:

```bash
npm test
npm run test:unit
npm run test:component
```

Vitest uses jsdom, React Testing Library, user-event, and strict HTTP/Socket.IO
test doubles. The tests cover runtime contract rejection, message ordering and
deduplication, retry identity, read and lifecycle transitions, transcript
scrolling and keyboard behavior, archive pagination, and inert archive content.
`npm run verify` runs lint, all Vitest suites, and the production build.

The Playwright suite is intentionally opt-in because it drives the real root
stack through the public frontend origin. Install Chromium once with
`npm run test:e2e:install`, start the version under test, and provide two
separate authenticated Playwright storage-state files plus a participant-owned
chat:

```powershell
$env:PLAYWRIGHT_BASE_URL = "http://localhost:3001"
$env:PLAYWRIGHT_REQUESTER_STORAGE_STATE = "C:\temp\requester.json"
$env:PLAYWRIGHT_COURIER_STORAGE_STATE = "C:\temp\courier.json"
$env:PLAYWRIGHT_CHAT_ID = "00000000-0000-4000-8000-000000000000"
$env:PLAYWRIGHT_ARCHIVE_ID = "00000000-0000-4000-8000-000000000000" # optional
npm run test:e2e
```

Keep storage-state files outside the repository or under ignored `e2e/.auth`;
they contain session credentials and must never be logged or committed. Without
the required live-stack inputs, Playwright reports the real-ingress tests as
skipped rather than silently substituting mocked backend behavior.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
