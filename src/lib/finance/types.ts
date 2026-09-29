export type Direction = "income" | "expense";
export type ChartSpec =
  | { type: "line"; title: string; data: Array<{ label: string; income: number; expense: number }> }
  | { type: "bar"; title: string; data: Array<{ label: string; value: number }> };

export type TransactionView = {
  id: string;
  direction: Direction;
  amountCents: number;
  description: string;
  merchant: string | null;
  occurredOn: string;
  categories: string[];
};

export type MessageView = {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: number;
  chart: ChartSpec | null;
  attachments: Array<{ id: string; originalName: string; mimeType: string; size: number; transcript: string | null }>;
};
