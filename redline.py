"""
NDA Redlining Script.

Loads a document and a playbook, then uses an LLM to detect clauses in the
document that violate the playbook's red flags. Emits a JSON list of issues
with exact text snippets, the playbook clause they violate, and a suggested
fix grounded in the playbook's ideal/fallback example.

Usage:
    export OPENAI_API_KEY=...     (or ANTHROPIC_API_KEY=...)
    python redline.py --document bad_document.txt --playbook playbook.json \
                      --output redline_output.json

The provider is auto-detected from the API key prefix (sk-ant-... -> Anthropic,
sk-... -> OpenAI). Override with --provider {openai,anthropic} if needed.
"""

from __future__ import annotations  # PEP 563: keeps `str | None` etc. valid on 3.8+

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Any


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


def load_playbook(path: str) -> list[dict]:
    return json.loads(Path(path).read_text(encoding="utf-8"))


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


def _compact_clause(clause: dict) -> dict:
    """Trim the playbook entry to fields the model actually needs."""
    return {
        "clause": clause["clause"],
        "definition": clause.get("clause_definition", ""),
        "red_flags": clause.get("red_flag", ""),
        "ideal_example": clause.get("example_ideal_clause", ""),
        "fallback_example": clause.get("example_fallback_clause", ""),
        "is_required": clause.get("is_required", True),
    }


def build_user_prompt(document: str, playbook: list[dict]) -> str:
    compact = [_compact_clause(c) for c in playbook]
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


# ---------- LLM calls ----------

def select_provider_and_key(cli_key: str | None,
                            override: str | None) -> tuple[str, str | None]:
    """Pick provider and the matching API key.

    Order of resolution:
    1. --provider flag forces the provider; the key comes from --api-key or
       the matching env var.
    2. --api-key without --provider: infer provider from the key prefix.
    3. No flags: prefer Anthropic if ANTHROPIC_API_KEY is set, else OpenAI if
       OPENAI_API_KEY is set, else Anthropic with no key (will error).

    The previous implementation picked whichever env var was non-empty *first*
    and then routed by env presence, which let a leftover OPENAI_API_KEY get
    sent to Anthropic. Selecting provider before key avoids that.
    """
    if override:
        provider = override
    elif cli_key and cli_key.startswith("sk-ant-"):
        provider = "anthropic"
    elif cli_key and cli_key.startswith(("sk-proj-", "sk-")):
        provider = "openai"
    elif os.environ.get("ANTHROPIC_API_KEY"):
        provider = "anthropic"
    elif os.environ.get("OPENAI_API_KEY"):
        provider = "openai"
    else:
        provider = "anthropic"

    if cli_key:
        api_key = cli_key
    elif provider == "anthropic":
        api_key = os.environ.get("ANTHROPIC_API_KEY")
    else:
        api_key = os.environ.get("OPENAI_API_KEY")
    return provider, api_key


def call_openai(system: str, user: str, model: str, api_key: str) -> str:
    try:
        from openai import OpenAI
    except ImportError as e:
        raise SystemExit("openai package not installed. pip install openai") from e

    client = OpenAI(api_key=api_key)
    resp = client.chat.completions.create(
        model=model,
        temperature=0,
        response_format={"type": "json_object"},
        messages=[
            {"role": "system", "content": system},
            {"role": "user", "content": user},
        ],
    )
    return resp.choices[0].message.content


def call_anthropic(system: str, user: str, model: str, api_key: str) -> str:
    try:
        import anthropic
    except ImportError as e:
        raise SystemExit("anthropic package not installed. pip install anthropic") from e

    client = anthropic.Anthropic(api_key=api_key)
    resp = client.messages.create(
        model=model,
        max_tokens=4096,
        temperature=0,
        system=system,
        messages=[{"role": "user", "content": user}],
    )
    # Anthropic returns a list of content blocks
    return "".join(block.text for block in resp.content if block.type == "text")


def call_llm(system: str, user: str, provider: str, model: str | None,
             api_key: str) -> str:
    if provider == "openai":
        return call_openai(system, user, model or "gpt-4o-2024-08-06", api_key)
    if provider == "anthropic":
        return call_anthropic(system, user, model or "claude-sonnet-4-6", api_key)
    raise ValueError(f"Unknown provider: {provider}")


# ---------- Response parsing & validation ----------

def parse_redlines(raw: str) -> list[dict]:
    # Some models wrap JSON in fences even when asked not to.
    fenced = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw, re.DOTALL)
    if fenced:
        raw = fenced.group(1)
    data = json.loads(raw)
    redlines = data.get("redlines") if isinstance(data, dict) else data
    if not isinstance(redlines, list):
        raise ValueError(f"Expected a list of redlines, got: {type(redlines)}")
    return redlines


def validate_and_clean(redlines: list[dict], document: str,
                       playbook: list[dict]) -> list[dict]:
    """Drop entries whose snippet doesn't actually appear in the document.

    A common failure mode is the model paraphrasing the snippet. We catch that
    here so downstream evaluation isn't biased by hallucinated quotes.
    """
    valid_clauses = {c["clause"] for c in playbook}
    cleaned, dropped = [], []
    norm_doc = _normalize_ws(document)
    for entry in redlines:
        snippet = entry.get("text_snippet", "").strip()
        clause = entry.get("playbook_clause_reference", "").strip()
        fix = entry.get("suggested_fix", "").strip()
        if not snippet or not clause or not fix:
            dropped.append((entry, "missing field"))
            continue
        if clause not in valid_clauses:
            dropped.append((entry, f"unknown clause: {clause}"))
            continue
        if _normalize_ws(snippet) not in norm_doc:
            dropped.append((entry, "snippet not in document"))
            continue
        cleaned.append({
            "text_snippet": snippet,
            "playbook_clause_reference": clause,
            "suggested_fix": fix,
        })

    if dropped:
        sys.stderr.write(f"[warn] dropped {len(dropped)} invalid entries:\n")
        for entry, reason in dropped:
            sys.stderr.write(f"  - {reason}: {entry.get('text_snippet','')[:80]}...\n")
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

    provider, api_key = select_provider_and_key(args.api_key, args.provider)
    if not api_key:
        sys.exit("No API key. Set ANTHROPIC_API_KEY (or OPENAI_API_KEY), or pass --api-key.")

    document = load_document(args.document)
    playbook = load_playbook(args.playbook)

    system = SYSTEM_PROMPT
    user = build_user_prompt(document, playbook)

    print(f"[info] provider={provider} model={args.model or 'default'} clauses={len(playbook)}")
    raw = call_llm(system, user, provider, args.model, api_key)

    redlines = parse_redlines(raw)
    redlines = validate_and_clean(redlines, document, playbook)

    Path(args.output).write_text(json.dumps(redlines, indent=2, ensure_ascii=False))
    print(f"[info] wrote {len(redlines)} redlines to {args.output}")


if __name__ == "__main__":
    main()
