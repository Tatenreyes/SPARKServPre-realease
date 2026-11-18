export const PHILIPPINE_TIME_ZONE = "Asia/Manila";

const dateKey = new Intl.DateTimeFormat("en-CA", {
  timeZone: PHILIPPINE_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function startOfPhilippineDay(now = new Date()): Date {
  return new Date(dateKey.format(now) + "T00:00:00+08:00");
}

/** Convert a datetime-local value on SPARKServ into its actual instant. */
export function parsePhilippineAppointment(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return null;
  const date = new Date(value + ":00+08:00");
  if (!Number.isFinite(date.getTime()) || dateKey.format(date) !== value.slice(0, 10)) return null;
  return date;
}

const appointmentDisplay = new Intl.DateTimeFormat("en-PH", {
  timeZone: PHILIPPINE_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  hour12: true,
});

export function formatPhilippineAppointment(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "N/A" : appointmentDisplay.format(date);
}
