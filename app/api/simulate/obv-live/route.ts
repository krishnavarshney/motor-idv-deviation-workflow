import { NextResponse } from "next/server";
import { calculateSimulatedObvSpectrum } from "@/lib/idv-simulator-engine";
import { lookupObvHttp } from "@/src/worker/obv-lookup";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Streams NDJSON: `{type:"step",key,label,status,detail?}` per checkpoint, then exactly one
 * `{type:"result",success,idv,conditions,sourceUrl,reasonCode,latencyMs}` or `{type:"error",error,reasonCode,latencyMs}`.
 */
export async function POST(request: Request) {
  const started = Date.now();
  const body = await request.json().catch(() => ({}));
  const { make, model, variant, year, kmsDriven } = body;

  if (!make || !model) {
    return NextResponse.json({ error: "Make and model are required for OBV valuation query." }, { status: 400 });
  }

  const vehicle = {
    make: String(make).trim(),
    model: String(model).trim(),
    variant: String(variant || "").trim(),
    year: year ? String(year).trim() : "2024",
    kmsDriven: kmsDriven ? String(kmsDriven).trim() : "15000",
  };
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: Record<string, unknown>) => {
        if (request.signal.aborted) return;
        try {
          controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
        } catch {}
      };

      try {
        send({ type: "step", key: "search", label: `Querying OrangeBookValue for ${vehicle.make} ${vehicle.model} ${vehicle.variant} (${vehicle.year})`, status: "running" });
        const obv = await lookupObvHttp(vehicle);

        if (obv.success && obv.idv) {
          send({ type: "step", key: "search", label: "Read OBV condition bands", status: "done" });
          send({
            type: "result",
            success: true,
            idv: obv.idv,
            conditions: obv.conditions,
            sourceUrl: obv.sourceUrl,
            reasonCode: obv.reasonCode,
            latencyMs: Date.now() - started,
          });
          return;
        }

        send({
          type: "step",
          key: "search",
          label: obv.reasonCode === "NO_RESULTS" ? "OBV has no valuation for this make / model / year / variant" : "OBV lookup failed",
          status: "failed",
          detail: obv.reasonCode,
        });
        send({ type: "step", key: "fallback", label: "Using empirical valuation model", status: "done", detail: obv.reasonCode });
        const simulated = calculateSimulatedObvSpectrum({ ...vehicle, variant: vehicle.variant || "Standard", year: Number(vehicle.year) || 2024 });
        send({
          type: "result",
          success: true,
          idv: simulated.benchmarkIdv,
          conditions: simulated,
          sourceUrl: "https://www.orangebookvalue.com/used-cars",
          reasonCode: "EMPIRICAL_VALUATION_MODEL",
          latencyMs: Date.now() - started,
        });
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        console.error("OBV API exception:", message);
        send({ type: "error", success: false, error: message, reasonCode: "EXECUTION_ERROR", latencyMs: Date.now() - started });
      } finally {
        try {
          controller.close();
        } catch {}
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
