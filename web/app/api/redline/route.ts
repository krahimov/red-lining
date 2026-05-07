import { NextResponse } from "next/server";
import playbook from "@/lib/playbook.json";
import { runRedline } from "@/lib/redline";
import { isRtf, stripRtf } from "@/lib/strip-rtf";
import type { PlaybookClause } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: Request) {
  const { document: raw } = (await req.json()) as { document?: string };
  if (!raw || raw.trim().length === 0) {
    return NextResponse.json({ error: "Document is required." }, { status: 400 });
  }

  // Strip RTF if the upload is a .rtf disguised as text. RTF byte escapes
  // like \'93 / \'94 (smart quotes) end up in the model's verbatim quotes,
  // and `\'` is not a valid JSON string escape -- so without this step the
  // response fails to parse on the way back.
  const wasRtf = isRtf(raw);
  const document = wasRtf ? stripRtf(raw) : raw;
  if (wasRtf) {
    console.log(`[/api/redline] stripped RTF: ${raw.length} -> ${document.length} chars`);
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
      sanitizedDocument: wasRtf ? document : undefined,
    });
  } catch (err) {
    console.error("[/api/redline] failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}
