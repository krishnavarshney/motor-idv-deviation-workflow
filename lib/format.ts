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
