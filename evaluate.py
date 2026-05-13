"""
Evaluation script for the redlining system.

Compares the model's redline_output.json against expected_output.json:

1. Matches predictions to expectations using a hybrid score
   (clause-name agreement + snippet text overlap).
2. Reports detection metrics: precision, recall, F1, and per-clause hits/misses.
3. Scores suggested_fix quality on matched pairs using lexical similarity by
   default, with an optional LLM-as-judge mode (--use-llm-judge) for a more
   semantic score.

Usage:
    python evaluate.py --predicted redline_output.json \
                       --expected expected_output.json \
                       --report evaluation.txt
"""

from __future__ import annotations  # PEP 563: keeps `str | None` etc. valid on 3.8+

import argparse
import json
import re
import sys
import os
from difflib import SequenceMatcher
from pathlib import Path

from pydantic import ValidationError

from schemas import Redline, load_redlines


# ---------- Loading & normalization ----------

# load_redlines is imported from schemas.py -- runs Pydantic validation at
# the input boundary, so malformed predicted/expected files fail loudly here
# instead of crashing inside the matching loop.


def normalize(text: str) -> str:
    """Lowercase, collapse whitespace, strip punctuation noise.

    We're lenient on quote style, dashes, and whitespace because models often
    output equivalent but non-identical text. This shouldn't be confused with
    the redline.py validator, which requires the snippet to appear verbatim in
    the source document.
    """
    if not text:
        return ""
    text = text.lower()
    text = (text.replace("‘", "'").replace("’", "'")
                .replace("“", '"').replace("”", '"')
                .replace("–", "-").replace("—", "-")
                .replace("‑", "-"))
    text = re.sub(r"\s+", " ", text)
    text = re.sub(r"[\"'`]", "", text)
    return text.strip()


# ---------- Similarity ----------

def seq_ratio(a: str, b: str) -> float:
    """Character-level similarity, robust to small edits."""
    return SequenceMatcher(None, a, b).ratio()


def token_overlap(a: str, b: str) -> float:
    """Jaccard over content tokens. Captures vocabulary overlap independent
    of order, which complements seq_ratio's order-sensitive view."""
    sa = set(re.findall(r"\w+", a))
    sb = set(re.findall(r"\w+", b))
    if not sa or not sb:
        return 0.0
    return len(sa & sb) / len(sa | sb)


def snippet_similarity(a: str, b: str) -> float:
    a, b = normalize(a), normalize(b)
    return 0.5 * seq_ratio(a, b) + 0.5 * token_overlap(a, b)


# ---------- Matching ----------

# Hyperparams chosen so trivial near-misses still match while clearly different
# snippets do not. Clause-name agreement is weighted heavily because a snippet
# can violate the spirit of the wrong clause -- in that case we want the model
# to be penalized rather than credited.
CLAUSE_WEIGHT = 0.5
SNIPPET_WEIGHT = 0.5
MATCH_THRESHOLD = 0.55  # combined score required to count as a match


def pair_score(pred: Redline, exp: Redline) -> float:
    clause_match = 1.0 if pred.playbook_clause_reference == exp.playbook_clause_reference else 0.0
    snippet = snippet_similarity(pred.text_snippet, exp.text_snippet)
    return CLAUSE_WEIGHT * clause_match + SNIPPET_WEIGHT * snippet


def greedy_match(predicted: list[Redline], expected: list[Redline]) -> tuple[
        list[tuple[int, int, float]], set[int], set[int]]:
    """Greedy assignment: highest-scoring pairs first, no double-matching.

    Returns (matches, unmatched_pred_idx, unmatched_exp_idx).
    """
    candidates = []
    for i, p in enumerate(predicted):
        for j, e in enumerate(expected):
            s = pair_score(p, e)
            if s >= MATCH_THRESHOLD:
                candidates.append((s, i, j))
    candidates.sort(reverse=True)

    used_p, used_e, matches = set(), set(), []
    for s, i, j in candidates:
        if i in used_p or j in used_e:
            continue
        used_p.add(i)
        used_e.add(j)
        matches.append((i, j, s))

    unmatched_pred = set(range(len(predicted))) - used_p
    unmatched_exp = set(range(len(expected))) - used_e
    return matches, unmatched_pred, unmatched_exp


# ---------- Fix-quality scoring ----------

def lexical_fix_score(pred_fix: str, exp_fix: str) -> float:
    return snippet_similarity(pred_fix, exp_fix)


def llm_judge_fix(pred_fix: str, exp_fix: str, clause: str,
                  api_key: str, provider: str, model: str | None) -> float:
    """LLM-as-judge: 0..1 score for how well pred_fix achieves the same legal
    intent as exp_fix. Used only when --use-llm-judge is set."""
    system = ("You are a legal evaluator. Compare two replacement clauses "
              "for the same NDA provision and rate how well the candidate "
              "captures the same legal protections as the reference. Output "
              'ONLY a JSON object: {"score": <float 0..1>, "reason": "<short>"}.')
    user = (f"Clause: {clause}\n\n"
            f"REFERENCE replacement:\n{exp_fix}\n\n"
            f"CANDIDATE replacement:\n{pred_fix}\n\n"
            "Score how well the candidate matches the reference's legal "
            "intent and protections (1.0 = equivalent, 0.0 = unrelated).")

    if provider == "openai":
        from openai import OpenAI
        client = OpenAI(api_key=api_key)
        resp = client.chat.completions.create(
            model=model or "gpt-4o-mini",
            temperature=0,
            response_format={"type": "json_object"},
            messages=[{"role": "system", "content": system},
                      {"role": "user", "content": user}],
        )
        raw = resp.choices[0].message.content
    else:
        import anthropic
        client = anthropic.Anthropic(api_key=api_key)
        resp = client.messages.create(
            model=model or "claude-sonnet-4-6",
            max_tokens=300,
            temperature=0,
            system=system,
            messages=[{"role": "user", "content": user}],
        )
        raw = "".join(b.text for b in resp.content if b.type == "text")

    fenced = re.search(r"\{.*\}", raw, re.DOTALL)
    payload = json.loads(fenced.group(0) if fenced else raw)
    return float(payload.get("score", 0.0))


# ---------- Reporting ----------

def build_report(predicted: list[Redline], expected: list[Redline],
                 matches: list[tuple[int, int, float]],
                 unmatched_pred: set[int], unmatched_exp: set[int],
                 fix_scores: list[float]) -> str:
    tp = len(matches)
    fp = len(unmatched_pred)
    fn = len(unmatched_exp)
    precision = tp / (tp + fp) if (tp + fp) else 0.0
    recall = tp / (tp + fn) if (tp + fn) else 0.0
    f1 = 2 * precision * recall / (precision + recall) if (precision + recall) else 0.0
    avg_fix = sum(fix_scores) / len(fix_scores) if fix_scores else 0.0

    lines = []
    lines.append("=" * 72)
    lines.append("NDA Redlining Evaluation Report")
    lines.append("=" * 72)
    lines.append("")
    lines.append("Detection metrics (snippet + clause-name match, threshold "
                 f"{MATCH_THRESHOLD}):")
    lines.append(f"  predicted issues : {len(predicted)}")
    lines.append(f"  expected  issues : {len(expected)}")
    lines.append(f"  true positives   : {tp}")
    lines.append(f"  false positives  : {fp}")
    lines.append(f"  false negatives  : {fn}")
    lines.append(f"  precision        : {precision:.3f}")
    lines.append(f"  recall           : {recall:.3f}")
    lines.append(f"  F1               : {f1:.3f}")
    lines.append("")
    lines.append(f"Suggested-fix quality (avg over {len(fix_scores)} matched pairs):")
    lines.append(f"  mean fix score   : {avg_fix:.3f}")
    lines.append("")
    lines.append("Per-clause detection breakdown:")
    clause_stats: dict[str, dict[str, int]] = {}
    for e in expected:
        c = e.playbook_clause_reference
        clause_stats.setdefault(c, {"expected": 0, "matched": 0})
        clause_stats[c]["expected"] += 1
    for i, j, _ in matches:
        c = expected[j].playbook_clause_reference
        clause_stats[c]["matched"] += 1
    for c, st in sorted(clause_stats.items()):
        lines.append(f"  {c:<40s} {st['matched']}/{st['expected']}")
    lines.append("")

    if matches:
        lines.append("Matched pairs (sorted by combined score):")
        for i, j, score in sorted(matches, key=lambda x: -x[2]):
            p, e = predicted[i], expected[j]
            fix_sim = lexical_fix_score(p.suggested_fix, e.suggested_fix)
            lines.append(f"  - clause: {e.playbook_clause_reference}")
            lines.append(f"    pair score: {score:.3f}  fix lexical sim: {fix_sim:.3f}")
            lines.append(f"    expected snippet: {_short(e.text_snippet)}")
            lines.append(f"    predicted snippet: {_short(p.text_snippet)}")
            lines.append("")

    if unmatched_exp:
        lines.append("Missed (expected but not predicted):")
        for j in unmatched_exp:
            e = expected[j]
            lines.append(f"  - {e.playbook_clause_reference}: {_short(e.text_snippet)}")
        lines.append("")

    if unmatched_pred:
        lines.append("Spurious (predicted but not expected):")
        for i in unmatched_pred:
            p = predicted[i]
            lines.append(f"  - {p.playbook_clause_reference}: {_short(p.text_snippet)}")
        lines.append("")

    return "\n".join(lines)


def _short(s: str, n: int = 120) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    return s if len(s) <= n else s[:n - 3] + "..."


# ---------- Entry point ----------

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--predicted", default="redline_output.json")
    ap.add_argument("--expected", default="expected_output.json")
    ap.add_argument("--report", default="evaluation.txt")
    ap.add_argument("--use-llm-judge", action="store_true",
                    help="Use LLM-as-judge for fix-quality scoring (costs API).")
    ap.add_argument("--provider", choices=["openai", "anthropic"], default=None)
    ap.add_argument("--model", default=None)
    ap.add_argument("--api-key", default=None)
    args = ap.parse_args()

    try:
        predicted = load_redlines(args.predicted)
        expected = load_redlines(args.expected)
    except (ValidationError, ValueError) as e:
        sys.exit(f"Input validation failed: {e}")

    matches, unmatched_pred, unmatched_exp = greedy_match(predicted, expected)

    fix_scores = []
    if args.use_llm_judge:
        # Same provider/key resolution as redline.py: pick provider first, then
        # the matching key, so a leftover OPENAI_API_KEY can't be routed to
        # Anthropic.
        if args.provider:
            provider = args.provider
        elif args.api_key and args.api_key.startswith("sk-ant-"):
            provider = "anthropic"
        elif args.api_key and args.api_key.startswith(("sk-proj-", "sk-")):
            provider = "openai"
        elif os.environ.get("ANTHROPIC_API_KEY"):
            provider = "anthropic"
        elif os.environ.get("OPENAI_API_KEY"):
            provider = "openai"
        else:
            provider = "anthropic"
        api_key = (args.api_key
                   or (os.environ.get("ANTHROPIC_API_KEY") if provider == "anthropic"
                       else os.environ.get("OPENAI_API_KEY")))
        if not api_key:
            sys.exit("--use-llm-judge requires ANTHROPIC_API_KEY (or OPENAI_API_KEY).")
        for i, j, _ in matches:
            fix_scores.append(llm_judge_fix(
                predicted[i].suggested_fix,
                expected[j].suggested_fix,
                expected[j].playbook_clause_reference,
                api_key, provider, args.model,
            ))
    else:
        for i, j, _ in matches:
            fix_scores.append(lexical_fix_score(
                predicted[i].suggested_fix,
                expected[j].suggested_fix,
            ))

    report = build_report(predicted, expected, matches,
                          unmatched_pred, unmatched_exp, fix_scores)
    Path(args.report).write_text(report)
    print(report)
    print(f"\n[info] report written to {args.report}")


if __name__ == "__main__":
    main()
