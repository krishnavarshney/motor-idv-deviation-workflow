export function money(v: unknown) {
  if (v == null || v === "") return "—";
  return "₹" + Number(v).toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

export function humanize(s: string | null | undefined) {
  return s ? s.replaceAll("_", " ") : "—";
}

export function dateTime(v: string | null | undefined) {
  return v ? new Date(v).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" }) : "—";
}

export function vehicleName(...parts: (string | null | undefined)[]) {
  return parts.filter(Boolean).join(" ") || "Unresolved";
}

const IST_OFFSET_MS = 5.5 * 3_600_000; // India has no DST

export function startOfDayIst(now: Date) {
  return new Date(Math.floor((now.getTime() + IST_OFFSET_MS) / 86_400_000) * 86_400_000 - IST_OFFSET_MS);
}
