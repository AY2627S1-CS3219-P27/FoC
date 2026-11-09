import { readFile } from "node:fs/promises";

// Serves the same GeoJSON order-service validates pins against (mounted read-only, never copied).
export async function GET() {
  const path = process.env.CAMPUS_BOUNDARY_PATH;
  if (!path) return Response.json({ message: "Campus boundary is not configured." }, { status: 500 });
  try {
    return Response.json(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return Response.json({ message: "Campus boundary is unavailable." }, { status: 500 });
  }
}
