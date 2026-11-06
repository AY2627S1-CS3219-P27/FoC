import { connection } from "next/server";
import { HomeShell } from "./_shell/home-shell";

export default async function HomeLayout({ children }: LayoutProps<"/home">) {
  await connection();
  const socketPath = process.env.SOCKET_PATH ?? "/socket.io";

  return <HomeShell socketPath={socketPath}>{children}</HomeShell>;
}
