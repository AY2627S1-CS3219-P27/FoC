import { connection } from "next/server";
import type { ReactNode } from "react";
import { HomeShell } from "./home-shell";

// Shared by the chats and archives routes, which still use the pre-redesign shell. /home itself uses the redesigned AppShell.
export default async function WorkspaceLayout({ children }: { children: ReactNode }) {
  await connection();
  const socketPath = process.env.SOCKET_PATH ?? "/socket.io";

  return <HomeShell socketPath={socketPath}>{children}</HomeShell>;
}
