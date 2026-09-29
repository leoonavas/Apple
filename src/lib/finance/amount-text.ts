import { parseTransactionAmount } from "./money";

const numeric = String.raw`(?:\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[,.]\d{1,2})?)`;
const unitWords: Record<string, number> = {
  zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5,
  seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12,
  treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16,
  dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30,
  quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80,
  noventa: 90, cem: 100, cento: 100, duzentos: 200, duzentas: 200,
  trezentos: 300, trezentas: 300, quatrocentos: 400, quatrocentas: 400,
  quinhentos: 500, quinhentas: 500, seiscentos: 600, seiscentas: 600,
  setecentos: 700, setecentas: 700, oitocentos: 800, oitocentas: 800,
  novecentos: 900, novecentas: 900,
};
const numberWordPattern = Object.keys(unitWords).concat("mil", "e").sort((a, b) => b.length - a.length).join("|");
const wordMoney = new RegExp(String.raw`\b((?:(?:${numberWordPattern})\s+)+)(?:reais?|contos?|pilas?|mangos?)\b`, "g");
const wordCents = new RegExp(String.raw`^\s*e\s+((?:(?:${numberWordPattern})\s+)+|\d{1,2}\s+)centavos?\b`);

function normalize(text: string) {
  return text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

function parseWords(words: string): number | null {
  let total = 0;
  let current = 0;
  let used = false;
  for (const word of words.trim().split(/\s+/)) {
    if (word === "e") continue;
    if (word === "mil") {
      total += (current || 1) * 1000;
      current = 0;
      used = true;
      continue;
    }
    const value = unitWords[word];
    if (value === undefined) return null;
    current += value;
    used = true;
  }
  return used ? total + current : null;
}

type Candidate = { value: string; index: number; end: number; score: number };

function withCents(value: string, tail: string): { value: string; extraLength: number } {
  if (/[,.]\d{1,2}$/.test(value)) return { value, extraLength: 0 };
  const match = tail.match(wordCents);
  if (!match) return { value, extraLength: 0 };
  const cents = /^\d/.test(match[1].trim()) ? Number(match[1].trim()) : parseWords(match[1]);
  if (cents === null || cents < 0 || cents >= 100) return { value, extraLength: 0 };
  return { value: `${value},${String(cents).padStart(2, "0")}`, extraLength: match[0].length };
}

function collectCandidates(text: string): Candidate[] {
  const normalized = normalize(text);
  const candidates: Candidate[] = [];
  const add = (value: string, index: number, end: number, score: number) => {
    if (parseTransactionAmount(value) !== null || value === "0") candidates.push({ value, index, end, score });
  };

  for (const match of normalized.matchAll(new RegExp(String.raw`r\$\s*(${numeric})`, "g"))) {
    const end = match.index + match[0].length;
    const amount = withCents(match[1], normalized.slice(end).replace(/^\s*(?:reais?|contos?|pilas?|mangos?)/, ""));
    add(amount.value, match.index, end + amount.extraLength, 100);
  }
  for (const match of normalized.matchAll(new RegExp(String.raw`\b(${numeric})\s*(?:reais?|contos?|pilas?|mangos?)\b`, "g"))) {
    const end = match.index + match[0].length;
    const amount = withCents(match[1], normalized.slice(end));
    add(amount.value, match.index, end + amount.extraLength, 90);
  }
  for (const match of normalized.matchAll(/\b(\d+(?:[,.]\d{1,2})?)\s*k\b/g)) {
    const base = Number(match[1].replace(",", "."));
    if (Number.isFinite(base)) add(String(base * 1000), match.index, match.index + match[0].length, 90);
  }
  for (const match of normalized.matchAll(wordMoney)) {
    const reais = parseWords(match[1]);
    if (reais === null) continue;
    const end = match.index + match[0].length;
    const amount = withCents(String(reais), normalized.slice(end));
    add(amount.value, match.index, end + amount.extraLength, 90);
  }
  for (const match of normalized.matchAll(new RegExp(String.raw`\bsaldo\s+(?:base|inicial|atual)\s*(?::|=|de)?\s*(${numeric})`, "g"))) add(match[1], match.index, match.index + match[0].length, 80);
  for (const match of normalized.matchAll(new RegExp(String.raw`\b(${numeric})\b`, "g"))) {
    const preceding = normalized.slice(Math.max(0, match.index - 12), match.index);
    if (/\b(?:dia|ano)\s*$/.test(preceding)) continue;
    add(match[1], match.index, match.index + match[0].length, 10);
  }
  candidates.sort((a, b) => b.score - a.score || a.index - b.index);
  return candidates;
}

/** Extracts one explicit monetary amount while preferring currency and units over dates or wallet names. */
export function extractAmountText(text: string): string | null {
  return collectCandidates(text)[0]?.value ?? null;
}

/** Distinct explicit amounts for guarding against accidentally applying a multi-action message as one action. */
export function extractExplicitMoneyAmounts(text: string): string[] {
  const chosen: Candidate[] = [];
  for (const candidate of collectCandidates(text)) {
    if (candidate.score < 80) continue;
    if (chosen.some((item) => candidate.index < item.end && candidate.end > item.index)) continue;
    chosen.push(candidate);
  }
  return chosen.sort((a, b) => a.index - b.index).map((candidate) => candidate.value);
}
