import { AssistantIntent, type AssistantIntent as ParsedIntent } from "./schema";
import { callTextModel, callVisionModel, extractAttachmentText, transcribeAudio } from "./local-tools";
import { fallbackIntent, hasMultipleFinancialAmounts, requiresSafeClarification } from "./fallback";
import { normalizeMerchant, moneyMarkdown } from "@/lib/finance/money";
import type { WalletView } from "@/lib/finance/service";

export type LocalAttachmentInput = { id: string; originalName: string; mimeType: string; filePath: string };
export type LocalAnalysis = { parsed: ParsedIntent; extractedTexts: Array<{ attachmentId: string; text: string }>; errors: string[]; usedLocalModel: boolean };

export async function analyzeLocalMessage(input: {
  userText: string;
  attachments: LocalAttachmentInput[];
  categories: string[];
  wallets: WalletView[];
  history: string;
}): Promise<LocalAnalysis> {
  const extractedTexts: LocalAnalysis["extractedTexts"] = [];
  const errors: string[] = [];
  const imagePaths: string[] = [];
  for (const file of input.attachments) {
    if (file.mimeType.startsWith("image/") && file.mimeType !== "image/heic") imagePaths.push(file.filePath);
    try {
      const text = file.mimeType.startsWith("audio/")
        ? await transcribeAudio(file.filePath)
        : await extractAttachmentText(file.filePath, file.mimeType);
      if (text) extractedTexts.push({ attachmentId: file.id, text: text.slice(0, 100_000) });
    } catch (error) {
      errors.push(`${file.originalName}: ${error instanceof Error ? error.message : "falha desconhecida"}`);
    }
  }
  const allText = [input.userText, ...extractedTexts.map((entry) => entry.text)].filter(Boolean).join("\n\n").trim();
  const rules = fallbackIntent(allText, input.categories, input.wallets);
  let parsed: ParsedIntent = rules;
  let usedLocalModel = false;
  if (!canUseRuleResult(rules, allText, input.attachments)) {
    try {
      const walletContext = input.wallets.map((wallet) => `${wallet.name} (${wallet.kind}): ${moneyMarkdown(wallet.balanceCents)}`);
      const output = imagePaths.length
        ? await callVisionModel(allText, imagePaths, input.categories, input.history, walletContext)
        : await callTextModel(allText, input.categories, input.history, walletContext);
      parsed = AssistantIntent.parse(JSON.parse(output));
      usedLocalModel = true;
    } catch { parsed = rules; }
  }
  return { parsed, extractedTexts, errors, usedLocalModel };
}

function canUseRuleResult(intent: ParsedIntent, text: string, files: LocalAttachmentInput[]): boolean {
  if (intent.intent === "wallet" || hasMultipleFinancialAmounts(text) || requiresSafeClarification(text)) return true;
  if (files.some((file) => !file.mimeType.startsWith("audio/"))) return false;
  const normalized = normalizeMerchant(text);
  if (/\b(?:amanha|corrigindo|entre|desde|ate)\b/.test(normalized) || /\b\d{1,2}[\/-]\d{1,2}\b/.test(text)) return false;
  if (intent.intent === "transaction") return intent.transactions.length === 1 && !!intent.transactions[0]?.direction && !!intent.transactions[0]?.amount && intent.transactions[0].confidence >= 0.7;
  if (intent.intent === "recurrence") return !!intent.recurrence?.direction && !!intent.recurrence.amount && !!intent.recurrence.frequency;
  return intent.intent === "report" || intent.intent === "advice";
}
