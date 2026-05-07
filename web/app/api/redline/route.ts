import { NextResponse } from "next/server";
import defaultPlaybook from "@/lib/playbook.json";
import { runRedline } from "@/lib/redline";
import { isRtf, stripRtf } from "@/lib/strip-rtf";
import type { PlaybookClause } from "@/lib/types";

export const runtime = "nodejs";
export const maxDuration = 60;

type Body = {
  document?: string;
  playbook?: unknown;
  playbookName?: string;
};

function validatePlaybook(value: unknown): PlaybookClause[] {
  if (!Array.isArray(value)) {
    throw new Error("Playbook must be a JSON array of clause objects.");
  }
  if (value.length === 0) {
    throw new Error("Playbook is empty.");
  }
  if (value.length > 100) {
    throw new Error(`Playbook has ${value.length} clauses; cap is 100.`);
  }
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    if (!c || typeof c !== "object") {
      throw new Error(`Clause #${i + 1} is not an object.`);
    }
    const clause = (c as Record<string, unknown>).clause;
    if (typeof clause !== "string" || clause.trim().length === 0) {
      throw new Error(`Clause #${i + 1} is missing a "clause" name.`);
    }
  }
  return value as PlaybookClause[];
}

export async function POST(req: Request) {
  const body = (await req.json()) as Body;
  const raw = body.document;
  if (!raw || raw.trim().length === 0) {
    return NextResponse.json({ error: "Document is required." }, { status: 400 });
  }

  let playbook: PlaybookClause[];
  let playbookSource: "default" | "custom";
  try {
    if (body.playbook == null) {
      playbook = defaultPlaybook as PlaybookClause[];
      playbookSource = "default";
    } else {
      playbook = validatePlaybook(body.playbook);
      playbookSource = "custom";
    }
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid playbook." },
      { status: 400 },
    );
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

  console.log(`[/api/redline] playbook=${playbookSource} (${playbook.length} clauses)${
    body.playbookName ? ` "${body.playbookName}"` : ""
  }`);

  try {
    const result = await runRedline(document, playbook, apiKey);
    return NextResponse.json({
      ...result,
      documentLineCount: document.split(/\r?\n/).length,
      sanitizedDocument: wasRtf ? document : undefined,
      playbookSource,
      playbookClauseCount: playbook.length,
    });
  } catch (err) {
    console.error("[/api/redline] failed:", err);
    const message = err instanceof Error ? err.message : "Unknown error";
    const stack = err instanceof Error ? err.stack : undefined;
    return NextResponse.json({ error: message, stack }, { status: 500 });
  }
}
