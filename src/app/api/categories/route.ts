import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestHasValidSession, validOrigin } from "@/lib/auth";
import { createCategory, getCategories } from "@/lib/finance/service";

export async function GET(request: NextRequest) {
  if (!(await requestHasValidSession(request))) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ categories: await getCategories() });
}

export async function POST(request: NextRequest) {
  if (!(await requestHasValidSession(request)) || !validOrigin(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const body = z.object({ name: z.string().trim().min(2).max(32) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Informe um nome de categoria entre 2 e 32 caracteres." }, { status: 400 });
  try {
    const id = await createCategory(body.data.name);
    return NextResponse.json({ id, name: body.data.name }, { status: 201 });
  } catch (error) {
    const duplicate = error instanceof Error && error.message.includes("já existe");
    return NextResponse.json({ error: duplicate ? error.message : "Não foi possível criar a categoria." }, { status: duplicate ? 409 : 500 });
  }
}
