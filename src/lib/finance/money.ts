export const MAX_TRANSACTION_AMOUNT_CENTS = 100_000_000_000;

export function parseMoney(value: string | number): number | null {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? Math.round(value * 100) : null;
  const clean = value.trim().replace(/R\$\s?/gi, "").replace(/\s/g, "");
  if (!clean) return null;
  let normalized = clean;
  if (clean.includes(",")) normalized = clean.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(?:\.\d{3})+$/.test(clean)) normalized = clean.replace(/\./g, "");
  const amount = Number(normalized);
  return Number.isFinite(amount) && amount > 0 ? Math.round(amount * 100) : null;
}

export function parseTransactionAmount(value: string | number): number | null {
  const cents = parseMoney(value);
  return cents !== null && cents <= MAX_TRANSACTION_AMOUNT_CENTS ? cents : null;
}

export function parseNonNegativeMoney(value: string): number | null {
  const clean = value.trim().replace(/R\$\s?/gi, "").replace(/\s/g, "");
  if (!clean) return null;
  if (/^0+(?:[.,]0{1,2})?$/.test(clean)) return 0;
  const cents = parseMoney(value);
  return cents !== null && cents <= MAX_TRANSACTION_AMOUNT_CENTS ? cents : null;
}

export function moneyMarkdown(cents: number): string {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(cents / 100);
}

export function normalizeMerchant(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
