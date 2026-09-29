import { z } from "zod";

const TransactionCandidate = z.object({
  direction: z.enum(["income", "expense"]).nullable(),
  amount: z.string().nullable(),
  occurredOn: z.string().nullable(),
  merchant: z.string().nullable(),
  description: z.string().nullable(),
  categories: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.5),
  evidence: z.string().nullable().default(null),
});

const WalletKind = z.enum(["checking", "savings", "investment"]);
const WalletAction = z.object({
  action: z.enum(["create", "transfer", "add_balance", "remove_balance", "balance", "set_balance", "rename"]),
  walletName: z.string().nullable(),
  walletKind: WalletKind.nullable(),
  sourceWalletName: z.string().nullable(),
  sourceWalletKind: WalletKind.nullable(),
  amount: z.string().nullable(),
  newName: z.string().nullable(),
  description: z.string().nullable(),
});

export const AssistantIntent = z.object({
  intent: z.enum(["transaction", "recurrence", "report", "advice", "wallet", "unsupported", "clarification"]),
  transactions: z.array(TransactionCandidate).default([]),
  recurrence: z.object({
    name: z.string().nullable(),
    direction: z.enum(["income", "expense"]).nullable(),
    amount: z.string().nullable(),
    merchant: z.string().nullable(),
    description: z.string().nullable(),
    frequency: z.enum(["weekly", "monthly", "yearly"]).nullable(),
    startOn: z.string().nullable(),
    endOn: z.string().nullable(),
    categories: z.array(z.string()).default([]),
  }).nullable().default(null),
  report: z.object({
    period: z.enum(["today", "week", "month", "all", "custom"]).nullable(),
    start: z.string().nullable(),
    end: z.string().nullable(),
    categories: z.array(z.string()).default([]),
    groupBy: z.enum(["day", "week", "month", "category"]).nullable(),
  }).nullable().default(null),
  adviceTopic: z.enum(["budget", "salary", "cut-spending", "investing", "general"]).nullable().default(null),
  clarification: z.string().nullable().default(null),
  wallet: WalletAction.nullable().optional(),
});

export type AssistantIntent = z.infer<typeof AssistantIntent>;
