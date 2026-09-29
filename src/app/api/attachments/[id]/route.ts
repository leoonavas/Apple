import fs from "node:fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { requestHasValidSession } from "@/lib/auth";
import { rawDb } from "@/lib/db";

export const runtime = "nodejs";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!requestHasValidSession(request)) return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  const { id } = await params;
  const file = rawDb.prepare("SELECT original_name AS originalName, mime_type AS mimeType, disk_path AS diskPath FROM attachments WHERE id=?").get(id) as { originalName: string; mimeType: string; diskPath: string } | undefined;
  if (!file) return NextResponse.json({ error: "Anexo não encontrado." }, { status: 404 });
  try {
    const buffer = await fs.readFile(file.diskPath);
    return new NextResponse(buffer, { headers: { "content-type": file.mimeType, "content-disposition": `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
  } catch { return NextResponse.json({ error: "Arquivo local não encontrado." }, { status: 404 }); }
}
