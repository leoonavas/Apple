export const APP_TIME_ZONE = "America/Sao_Paulo";

export function localDate(date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

export function periodFor(period: "today" | "week" | "month" | "all" | "custom", start?: string | null, end?: string | null) {
  const today = localDate();
  if (period === "all") return { start: "0001-01-01", end: today, label: "todo o histórico" };
  if (period === "custom" && start && end) return { start, end, label: `de ${formatDate(start)} a ${formatDate(end)}` };
  if (period === "today") return { start: today, end: today, label: `hoje, ${formatDate(today)}` };
  if (period === "week") {
    const utc = new Date(`${today}T12:00:00Z`);
    const day = (utc.getUTCDay() + 6) % 7;
    utc.setUTCDate(utc.getUTCDate() - day);
    const monday = utc.toISOString().slice(0, 10);
    return { start: monday, end: today, label: `esta semana (${formatDate(monday)}–${formatDate(today)})` };
  }
  const monthStart = `${today.slice(0, 7)}-01`;
  return { start: monthStart, end: today, label: `este mês (${formatDate(monthStart)}–${formatDate(today)})` };
}

export function formatDate(value: string): string {
  const [year, month, day] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function clampMonthlyDay(year: number, monthIndex: number, day: number): string {
  const clamped = Math.min(day, new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate());
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(clamped).padStart(2, "0")}`;
}
