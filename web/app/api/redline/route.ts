import { NextResponse } from "next/server";
import playbook from "@/lib/playbook.json";
import { runRedline } from "@/lib/redline";
import type { PlaybookClause } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { document } = (await req.json()) as { document?: string };
  if (!document || document.trim().length === 0) {
    return NextResponse.json({ error: "Document is required." }, { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      { error: "ANTHROPIC_API_KEY is not configured on the server." },
      { status: 500 },
    );
  }

  try {
    const result = await runRedline(document, playbook as PlaybookClause[], apiKey);
    return NextResponse.json({
      ...result,
      documentLineCount: document.split(/\r?\n/).length,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
