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

The Socket.IO client must use WebSocket transport only and rely on the
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

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
