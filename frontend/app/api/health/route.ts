// Liveness for the Docker HEALTHCHECK: answers while the Next.js server is up.
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
