const philippineHour = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Manila",
  hour: "numeric",
  hourCycle: "h23",
});

export function getDashboardGreeting(now = new Date()): string {
  const hour = Number(philippineHour.format(now));
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}
