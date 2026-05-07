import Anthropic from "@anthropic-ai/sdk";
import type { PlaybookClause, Redline } from "./types";

const SYSTEM_PROMPT = `You are an expert NDA (Non-Disclosure Agreement) reviewer. \
You audit a contract against a structured playbook of clauses. For each clause \
in the playbook, you identify any wording in the document that triggers the \
clause's "red flags" and propose a replacement grounded in the clause's \
"ideal" (or fallback) example.

Rules:
1. text_snippet MUST be an exact, verbatim, contiguous substring of the document. \
Preserve original punctuation, spacing, and casing. Do not paraphrase.
2. Pick the smallest snippet that captures the problem -- typically a single \
sentence or short consecutive sentences. Do not include section numbers like \
"5.1" or section headings unless they are part of the problematic sentence.
3. playbook_clause_reference MUST be one of the provided clause names, copied verbatim.
4. suggested_fix should rewrite the offending text using the clause's ideal example \
as the anchor. Adapt placeholders (e.g. \${country}) to remain generic when no value is given.
5. Only flag a clause once per distinct issue. If two sentences cause the same red flag \
for the same clause, group them into one snippet.
6. Do not invent issues. If the document already aligns with the playbook for a clause, \
do not include it.
7. Output ONLY a JSON object of the form {"redlines": [ ... ]} with no other text.`;

function compactClause(c: PlaybookClause) {
  return {
    clause: c.clause,
    definition: c.clause_definition ?? "",
    red_flags: c.red_flag ?? "",
    ideal_example: c.example_ideal_clause ?? "",
    fallback_example: c.example_fallback_clause ?? "",
    is_required: c.is_required ?? true,
  };
}

function buildUserPrompt(document: string, playbook: PlaybookClause[]): string {
  const compact = playbook.map(compactClause);
  return `Review the DOCUMENT below against the PLAYBOOK. Return every clause-level issue as JSON.

PLAYBOOK (each entry describes one clause, its red flags, and ideal/fallback language):
${JSON.stringify(compact, null, 2)}

DOCUMENT (review against every playbook clause):
"""
${document}
"""

Output schema:
{
  "redlines": [
    {
      "text_snippet": "<exact verbatim quote from DOCUMENT>",
      "playbook_clause_reference": "<exact clause name from PLAYBOOK>",
      "suggested_fix": "<replacement text grounded in the clause's ideal example>"
    }
  ]
}

Output ONLY the JSON object.`;
}

const norm = (s: string) => s.replace(/\s+/g, " ").trim();

export type RedlineResult = {
  redlines: Redline[];
  dropped: { reason: string; entry: Partial<Redline> }[];
};

export async function runRedline(
  document: string,
  playbook: PlaybookClause[],
  apiKey: string,
  model = "claude-sonnet-4-6",
): Promise<RedlineResult> {
  const client = new Anthropic({ apiKey });
  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    temperature: 0,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: buildUserPrompt(document, playbook) }],
  });

  const text = response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");

  const fenced = text.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const payload = JSON.parse(fenced ? fenced[1] : text);
  const raw: Partial<Redline>[] = Array.isArray(payload) ? payload : payload.redlines ?? [];

  const validClauses = new Set(playbook.map((c) => c.clause));
  const normDoc = norm(document);

  const cleaned: Redline[] = [];
  const dropped: { reason: string; entry: Partial<Redline> }[] = [];

  for (const entry of raw) {
    const snippet = (entry.text_snippet ?? "").trim();
    const clause = (entry.playbook_clause_reference ?? "").trim();
    const fix = (entry.suggested_fix ?? "").trim();
    if (!snippet || !clause || !fix) {
      dropped.push({ reason: "missing field", entry });
      continue;
    }
    if (!validClauses.has(clause)) {
      dropped.push({ reason: `unknown clause: ${clause}`, entry });
      continue;
    }
    if (!normDoc.includes(norm(snippet))) {
      dropped.push({ reason: "snippet not in document", entry });
      continue;
    }
    cleaned.push({ text_snippet: snippet, playbook_clause_reference: clause, suggested_fix: fix });
  }

  return { redlines: cleaned, dropped };
}
