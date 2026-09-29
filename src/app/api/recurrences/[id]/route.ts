import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestHasValidSession, validOrigin } from "@/lib/auth";
import { toggleRecurrence } from "@/lib/finance/service";

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requestHasValidSession(request) || !validOrigin(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const body = z.object({ active: z.boolean() }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Estado inválido." }, { status: 400 });
  const { id } = await params;
  toggleRecurrence(id, body.data.active);
  return NextResponse.json({ ok: true });
}
