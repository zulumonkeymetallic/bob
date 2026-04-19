import { Timestamp } from "firebase/firestore";

export function isFsTimestamp(v: any): v is Timestamp {
  return v && typeof v === "object" && "seconds" in v && "nanoseconds" in v;
}

export function toDisplayDate(v: any): string {
  try {
    if (v == null) return "";
    if (isFsTimestamp(v)) return v.toDate().toISOString();
    if (v instanceof Date) return v.toISOString();
    if (typeof v === "number") return new Date(v).toISOString();
    if (typeof v === "string") {
      const d = new Date(v);
      return isNaN(d.getTime()) ? v : d.toISOString();
    }
    // Telemetry: log a warning for unexpected input
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.warn("[toDisplayDate] Unexpected date value", v);
    }
    return "";
  } catch {
    return "";
  }
}
