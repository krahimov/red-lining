"""
NDA Redlining Script.

Loads a document and a playbook, then uses an LLM (via Pydantic AI) to detect
clauses in the document that violate the playbook's red flags. Emits a JSON
list of issues with exact text snippets, the playbook clause they violate,
and a suggested fix grounded in the playbook's ideal/fallback example.

Usage:
    export ANTHROPIC_API_KEY=...     (or OPENAI_API_KEY=...)
    python redline.py --document bad_document.txt --playbook playbook.json \
                      --output redline_output.json

The provider is auto-detected from which env var is set. Override with
--provider {openai,anthropic} if needed.

Pydantic AI handles three things for us that we previously did by hand:
  1. Provider abstraction -- one model-id string picks Anthropic vs OpenAI.
  2. Schema-enforced output -- the agent forces tool-use / response_format
     so the model can't return a malformed shape.
  3. Automatic retry on validation failure -- if the model's first attempt
     fails Pydantic validation, the validation error is fed back and the
     model corrects itself (up to `retries` times).
"""

from __future__ import annotations  # PEP 563: keeps `str | None` etc. valid on 3.8+

import argparse
import json
import os
import re
import sys
from pathlib import Path

from pydantic import ValidationError
from pydantic_ai import Agent
from pydantic_ai.exceptions import UnexpectedModelBehavior

from schemas import PlaybookClause, Redline, RedlineResponse, load_playbook


# ---------- I/O helpers ----------

def load_document(path: str) -> str:
    """Load the document. Accepts plain .txt; strips RTF if a .rtf is given."""
    text = Path(path).read_text(encoding="utf-8", errors="replace")
    if text.lstrip().startswith("{\\rtf"):
        text = _strip_rtf(text)
    return text.strip()


def _strip_rtf(rtf: str) -> str:
    """Minimal RTF -> text. Good enough for the assignment's simple RTF."""
    # \'XX hex -> char
    rtf = re.sub(
        r"\\'([0-9a-fA-F]{2})",
        lambda m: bytes([int(m.group(1), 16)]).decode("cp1252", errors="replace"),
        rtf,
    )
    # \uNNNN unicode escapes (often paired with a fallback char)
    rtf = re.sub(r"\\u(-?\d+)\\?'?[0-9a-fA-F]{0,2}\s?",
                 lambda m: chr(int(m.group(1)) & 0xFFFF), rtf)
    rtf = re.sub(r"\\uc\d+\s?", "", rtf)
    # Paragraph / line breaks
    rtf = re.sub(r"\\par[d]?\b", "\n", rtf)
    rtf = re.sub(r"\\line\b", "\n", rtf)
    # Strip remaining control words and groups
    rtf = re.sub(r"\\[a-zA-Z]+-?\d* ?", "", rtf)
    rtf = re.sub(r"[{}]", "", rtf)
    rtf = rtf.replace("\\\\", "\\").replace("\\'", "'")
    # Normalize smart punctuation to ASCII to match common reference outputs
    rtf = (rtf.replace("’", "'").replace("‘", "'")
              .replace("“", '"').replace("”", '"')
              .replace("–", "-").replace("—", "-")
              .replace("‑", "-"))
    return rtf


# load_playbook is imported from schemas.py -- returns validated PlaybookClause models.


# ---------- Prompt construction ----------

SYSTEM_PROMPT = """You are an expert NDA (Non-Disclosure Agreement) reviewer. \
You audit a contract against a structured playbook of clauses. For each clause \
in the playbook, you identify any wording in the document that triggers the \
clause's "red flags" and propose a replacement grounded in the clause's \
"ideal" (or fallback) example.

Rules:
1. text_snippet MUST be an exact, verbatim, contiguous substring of the \
document. Preserve original punctuation, spacing, and casing. Do not paraphrase.
2. Pick the smallest snippet that captures the problem -- typically a single \
sentence or short consecutive sentences. Do not include section numbers like \
"5.1" or section headings unless they are part of the problematic sentence.
3. playbook_clause_reference MUST be one of the provided clause names, copied \
verbatim.
4. suggested_fix should rewrite the offending text using the clause's ideal \
example as the anchor. Adapt placeholders (e.g. ${country}) to remain generic \
when no value is given.
5. Only flag a clause once per distinct issue. If two sentences cause the same \
red flag for the same clause, group them into one snippet.
6. Do not invent issues. If the document already aligns with the playbook for a \
clause, do not include it.
7. Output ONLY a JSON object of the form {"redlines": [ ... ]} with no other text."""


def build_user_prompt(document: str, playbook: list[PlaybookClause]) -> str:
    compact = [c.to_compact_view() for c in playbook]
    playbook_block = json.dumps(compact, indent=2, ensure_ascii=False)

    return f"""Review the DOCUMENT below against the PLAYBOOK. Return every \
clause-level issue as JSON.

PLAYBOOK (each entry describes one clause, its red flags, and ideal/fallback \
language to anchor your suggested fix):
{playbook_block}

DOCUMENT (review against every playbook clause):
\"\"\"
{document}
\"\"\"

Output schema:
{{
  "redlines": [
    {{
      "text_snippet": "<exact verbatim quote from DOCUMENT>",
      "playbook_clause_reference": "<exact clause name from PLAYBOOK>",
      "suggested_fix": "<replacement text grounded in the clause's ideal example>"
    }}
  ]
}}

Output ONLY the JSON object."""


# ---------- LLM agent (Pydantic AI) ----------

def select_provider(cli_key: str | None, override: str | None) -> str:
    """Pick the provider. Pydantic AI reads the matching env var itself."""
    if override:
        return override
    if cli_key and cli_key.startswith("sk-ant-"):
        return "anthropic"
    if cli_key and cli_key.startswith(("sk-proj-", "sk-")):
        return "openai"
    if os.environ.get("ANTHROPIC_API_KEY"):
        return "anthropic"
    if os.environ.get("OPENAI_API_KEY"):
        return "openai"
    return "anthropic"  # last-resort default, will error if no key


DEFAULT_MODELS = {
    "anthropic": "claude-sonnet-4-6",
    "openai": "gpt-4o-2024-08-06",
}


def build_agent(provider: str, model: str | None,
                api_key: str | None) -> Agent[None, RedlineResponse]:
    """Construct a Pydantic AI agent that returns a validated RedlineResponse.

    `output_type=RedlineResponse` tells the agent to force structured output
    (Anthropic tool-use / OpenAI response_format) and run Pydantic validation
    on the result. `retries=2` means a validation failure is fed back to the
    model so it can self-correct -- exactly the failure mode our previous
    manual implementation could only detect and drop.
    """
    model_name = model or DEFAULT_MODELS[provider]

    if api_key:
        # Build a model object with an explicit provider so we can inject the
        # CLI-supplied key without relying on env vars.
        if provider == "anthropic":
            from pydantic_ai.models.anthropic import AnthropicModel
            from pydantic_ai.providers.anthropic import AnthropicProvider
            model_obj = AnthropicModel(model_name, provider=AnthropicProvider(api_key=api_key))
        else:
            from pydantic_ai.models.openai import OpenAIModel
            from pydantic_ai.providers.openai import OpenAIProvider
            model_obj = OpenAIModel(model_name, provider=OpenAIProvider(api_key=api_key))
        return Agent(
            model_obj,
            output_type=RedlineResponse,
            system_prompt=SYSTEM_PROMPT,
            output_retries=2,
        )

    # No explicit key -- let Pydantic AI read ANTHROPIC_API_KEY / OPENAI_API_KEY.
    return Agent(
        f"{provider}:{model_name}",
        output_type=RedlineResponse,
        system_prompt=SYSTEM_PROMPT,
        output_retries=2,
    )


# ---------- Domain validation ----------

def validate_redlines(redlines: list[Redline], document: str,
                      playbook: list[PlaybookClause]) -> list[Redline]:
    """Drop entries that pass Pydantic but fail domain checks.

    Two checks that Pydantic can't enforce without external context:
    - text_snippet must be a verbatim substring of the document (catches
      paraphrased hallucinations, our most important integrity guarantee).
    - playbook_clause_reference must name a real clause in the playbook.
    """
    valid_clauses = {c.clause for c in playbook}
    norm_doc = _normalize_ws(document)
    cleaned: list[Redline] = []
    dropped: list[tuple[Redline, str]] = []
    for r in redlines:
        if r.playbook_clause_reference not in valid_clauses:
            dropped.append((r, f"unknown clause: {r.playbook_clause_reference}"))
            continue
        if _normalize_ws(r.text_snippet) not in norm_doc:
            dropped.append((r, "snippet not in document"))
            continue
        cleaned.append(r)

    if dropped:
        sys.stderr.write(f"[warn] dropped {len(dropped)} invalid entries:\n")
        for r, reason in dropped:
            sys.stderr.write(f"  - {reason}: {r.text_snippet[:80]}...\n")
    return cleaned


def _normalize_ws(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


# ---------- Entry point ----------

def main():
    ap = argparse.ArgumentParser(description="Redline an NDA against a playbook using an LLM.")
    ap.add_argument("--document", default="bad_document.txt")
    ap.add_argument("--playbook", default="playbook.json")
    ap.add_argument("--output", default="redline_output.json")
    ap.add_argument("--provider", choices=["openai", "anthropic"], default=None)
    ap.add_argument("--model", default=None,
                    help="Model id (default: claude-sonnet-4-6 for anthropic, gpt-4o-2024-08-06 for openai)")
    ap.add_argument("--api-key", default=None,
                    help="Override env-var API key")
    args = ap.parse_args()

    provider = select_provider(args.api_key, args.provider)
    if not args.api_key and not os.environ.get(f"{provider.upper()}_API_KEY"):
        sys.exit(
            f"No API key. Set {provider.upper()}_API_KEY (or the other provider's "
            "key), or pass --api-key."
        )

    document = load_document(args.document)
    try:
        playbook = load_playbook(args.playbook)
    except (ValidationError, ValueError) as e:
        sys.exit(f"Playbook validation failed: {e}")

    user = build_user_prompt(document, playbook)
    agent = build_agent(provider, args.model, args.api_key)

    print(f"[info] provider={provider} model={args.model or DEFAULT_MODELS[provider]} clauses={len(playbook)}")
    try:
        result = agent.run_sync(user)
    except UnexpectedModelBehavior as e:
        sys.exit(
            f"Model returned malformed output even after retries: {e}. "
            "Try raising max_tokens, simplifying the playbook, or shortening the document."
        )

    redlines = validate_redlines(result.output.redlines, document, playbook)

    output = [r.model_dump() for r in redlines]
    Path(args.output).write_text(json.dumps(output, indent=2, ensure_ascii=False))
    print(f"[info] wrote {len(redlines)} redlines to {args.output}")


if __name__ == "__main__":
    main()
