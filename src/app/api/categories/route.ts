import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requestHasValidSession, validOrigin } from "@/lib/auth";
import { getCategories } from "@/lib/finance/service";
import { rawDb } from "@/lib/db";

export async function GET(request: NextRequest) {
  if (!requestHasValidSession(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  return NextResponse.json({ categories: getCategories() });
}

export async function POST(request: NextRequest) {
  if (!requestHasValidSession(request) || !validOrigin(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 403 });
  const body = z.object({ name: z.string().trim().min(2).max(32) }).safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Informe um nome de categoria entre 2 e 32 caracteres." }, { status: 400 });
  const id = `cat-${randomUUID()}`;
  try {
    rawDb.prepare("INSERT INTO categories(id,name,created_at) VALUES(?,?,?)").run(id, body.data.name, Date.now());
    return NextResponse.json({ id, name: body.data.name }, { status: 201 });
  } catch { return NextResponse.json({ error: "Essa categoria já existe." }, { status: 409 }); }
}
