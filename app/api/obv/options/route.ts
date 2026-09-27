import { NextResponse } from "next/server";
import { fetchObvOptions } from "@/src/worker/obv-lookup";

/** Proxies OBV's make → model → year → trim catalog: GET ?make=&model=&year= → { options: string[] }. */
export async function GET(request: Request) {
  const q = Object.fromEntries(new URL(request.url).searchParams);
  try {
    const options = await fetchObvOptions(q);
    return NextResponse.json({ options }, { headers: { "Cache-Control": "public, max-age=3600" } });
  } catch (err) {
    console.error("OBV options failed:", err, (err as { cause?: unknown })?.cause);
    return NextResponse.json({ options: [], error: err instanceof Error ? err.message : String(err) }, { status: 502 });
  }
}
