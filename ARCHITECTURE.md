# Architecture

A walkthrough of how this repo is organized and where the important decisions live. If you want to *run* the project, see [README.md](README.md). This document is for understanding *why* the code looks the way it does.

The project has two surfaces over the same logic:

```
                            ┌────────────────────────────┐
                            │  Anthropic / OpenAI LLM    │
                            │  (Claude Sonnet 4.6)       │
                            └─────────────▲──────────────┘
                                          │
                ┌─────────────────────────┴─────────────────────────┐
                │                                                   │
        ┌───────┴───────┐                                  ┌────────┴─────────┐
        │  redline.py   │                                  │ web/api/redline  │
        │   (CLI)       │                                  │  (Next.js route) │
        └───────┬───────┘                                  └────────┬─────────┘
                │                                                   │
       redline_output.json                                  React Reader view
                │                                                   ▲
        ┌───────┴───────┐                                            │
        │ evaluate.py   │                                  ┌────────┴─────────┐
        │   (CLI)       │                                  │ web/app/page.tsx │
        └───────┬───────┘                                  │ + components/    │
                │                                          └──────────────────┘
       evaluation.txt
```

The CLI is the required deliverable. The web UI is bonus — same prompt, same validator, different runtime.

---

## The CLI (required deliverable)

### [`redline.py`](redline.py) — detection

Single LLM call. End-to-end flow:

| Step | Where in the file |
| --- | --- |
| Load document (auto-strip RTF if needed) | [`load_document`](redline.py#L31) + [`_strip_rtf`](redline.py#L39) |
| Load playbook | [`load_playbook`](redline.py#L66) |
| Build the prompt | [`SYSTEM_PROMPT`](redline.py#L72) constant + [`build_user_prompt`](redline.py#L108) + [`_compact_clause`](redline.py#L96) |
| Pick provider & matching API key | [`select_provider_and_key`](redline.py#L140) |
| Call LLM | [`call_llm`](redline.py#L214) → [`call_openai`](redline.py#L177) / [`call_anthropic`](redline.py#L196) |
| Parse JSON response | [`parse_redlines`](redline.py#L225) (handles models that wrap in ```json fences```) |
| Validate snippets are in document | [`validate_and_clean`](redline.py#L237) |
| Write `redline_output.json` | [`main`](redline.py#L279) |

The two ideas worth knowing in detail:

- **Compact playbook view** ([`_compact_clause`](redline.py#L96)): the playbook is ~100 KB; only `clause`, `clause_definition`, `red_flag`, `example_ideal_clause`, `example_fallback_clause`, and `is_required` actually inform the model. Stripping the rest cuts the prompt to ~11k input tokens.
- **Snippet validator** ([`validate_and_clean`](redline.py#L237)): every entry's `text_snippet` has to be a verbatim substring of the document. Drops paraphrased hallucinations *before* anything downstream sees them. This is the single most important guarantee in the file.

### [`evaluate.py`](evaluate.py) — evaluation

Compares `redline_output.json` against `expected_output.json`.

| Concern | Where in the file |
| --- | --- |
| Normalize text for fair comparison | [`normalize`](evaluate.py#L37) |
| Snippet similarity (lex + token) | [`seq_ratio`](evaluate.py#L59) + [`token_overlap`](evaluate.py#L64) → [`snippet_similarity`](evaluate.py#L74) |
| Per-pair score (clause + snippet) | [`pair_score`](evaluate.py#L90) (hyperparams: [`CLAUSE_WEIGHT`](evaluate.py#L85), [`SNIPPET_WEIGHT`](evaluate.py#L86), [`MATCH_THRESHOLD`](evaluate.py#L87)) |
| Greedy matching | [`greedy_match`](evaluate.py#L98) |
| Fix-quality (lexical default) | [`lexical_fix_score`](evaluate.py#L127) |
| Fix-quality (LLM-judge mode) | [`llm_judge_fix`](evaluate.py#L131) — gated by `--use-llm-judge` |
| Report assembly | [`build_report`](evaluate.py#L175) |

The hybrid score is intentionally simple — `0.5 * clause_match + 0.5 * snippet_similarity` — because every other transformation we added made the matches worse on the held-out cases.

### [`requirements.txt`](requirements.txt)

Two SDKs, nothing else. Pick the one matching your API key.

---

## The inputs

| File | What it is |
| --- | --- |
| [`bad_document.txt`](bad_document.txt) | The NDA being reviewed — RTF stripped + smart quotes normalized to ASCII so snippets compare cleanly. |
| [`playbook.json`](playbook.json) | 16 clauses. Each has a `clause`, `clause_definition`, `red_flag`, `acceptable`, `example_ideal_clause`, `example_fallback_clause`. |
| [`expected_output.json`](expected_output.json) | 8 reference redlines — the ground truth that `evaluate.py` scores against. |

## The outputs

| File | Generated by |
| --- | --- |
| [`redline_output.json`](redline_output.json) | `redline.py` — top-level array of `{text_snippet, playbook_clause_reference, suggested_fix}`. |
| [`evaluation.txt`](evaluation.txt) | `evaluate.py` — precision, recall, F1, per-clause breakdown, matched / missed / spurious lists. |
| [`evaluation_llm_judge.txt`](evaluation_llm_judge.txt) | `evaluate.py --use-llm-judge` — same report but with semantic fix-quality scoring. |

---

## The web UI (bonus)

A Next.js 15 app under [`web/`](web/) that wraps the same logic in an editorial interface — drop a document, see the redlines render as marginalia.

### Server side

[`web/app/api/redline/route.ts`](web/app/api/redline/route.ts) is the only API endpoint. It:

1. Parses the request body (`document`, optional `playbook`).
2. Detects and strips RTF — calls [`isRtf`](web/lib/strip-rtf.ts#L67) + [`stripRtf`](web/lib/strip-rtf.ts#L12).
3. Checks for `ANTHROPIC_API_KEY` in the environment.
4. Calls [`runRedline`](web/lib/redline.ts#L69) in [`web/lib/redline.ts`](web/lib/redline.ts) — the TypeScript port of `redline.py` (same prompt, same `max_tokens` headroom, same validator).
5. Returns the redlines, anything dropped by the validator, and the *sanitized* document (so the client can render text that matches the snippets the LLM saw).

The prompt itself lives in [`SYSTEM_PROMPT`](web/lib/redline.ts#L4) inside [`web/lib/redline.ts`](web/lib/redline.ts), with [`buildUserPrompt`](web/lib/redline.ts#L36) and [`compactClause`](web/lib/redline.ts#L25) as the equivalents of the Python helpers. It's a verbatim port of the Python version. If you change one, change both. (A shared YAML/JSON config would be cleaner but felt like overkill for a take-home.)

[`web/lib/strip-rtf.ts`](web/lib/strip-rtf.ts) is the TypeScript port of [`redline.py::_strip_rtf`](redline.py#L39), extended to also drop RTF preamble (`\fonttbl`, `\colortbl`, `\stylesheet`), trailing line-continuation backslashes, and runs of blank lines.

[`web/lib/types.ts`](web/lib/types.ts) defines `Redline`, `PlaybookClause`, and the API response shape.

[`web/lib/playbook.json`](web/lib/playbook.json) is a copy of the root `playbook.json` — imported directly with TypeScript's `resolveJsonModule`.

### Client side

[`web/app/layout.tsx`](web/app/layout.tsx) — root layout. Loads Fraunces, Source Serif 4, JetBrains Mono via [`web/app/fonts.ts`](web/app/fonts.ts) and applies the parchment background + paper grain from [`web/app/globals.css`](web/app/globals.css).

[`web/app/page.tsx`](web/app/page.tsx) — the top-level state machine. Four phases: `intake → processing → results → error`. Owns the API call.

The phases render dedicated components:

| Phase | Component | Responsibility |
| --- | --- | --- |
| intake | [`web/components/Hero.tsx`](web/components/Hero.tsx) + [`web/components/Intake.tsx`](web/components/Intake.tsx) | Landing copy, drop zones for document and playbook |
| processing | [`web/components/Processing.tsx`](web/components/Processing.tsx) | Animated three-stage progress |
| results | [`web/components/Reader.tsx`](web/components/Reader.tsx) | Editorial two-column layout with redlined runs + marginalia |

Persistent across phases:

| Component | Responsibility |
| --- | --- |
| [`web/components/Header.tsx`](web/components/Header.tsx) | Sticky masthead, wax-seal logo, case number |
| [`web/components/Seal.tsx`](web/components/Seal.tsx) | The wax-seal SVG used in the masthead |

### The hot spot: [`Reader.tsx`](web/components/Reader.tsx)

[`buildSpans`](web/components/Reader.tsx#L20) is where the document is interleaved with redlined runs. It:

1. Finds the first occurrence of each `text_snippet` in the document.
2. Sorts placements by position.
3. Drops any placement that overlaps an earlier one (handles snippets that fully contain another).
4. Walks the document linearly, emitting alternating `text` and `redline` spans.

Each `redline` span renders a `<RedlinedRun>` — an ink-underline animation that draws across the text, plus a tilted numbered seal in `<sup>`. The numbered seal pairs to a `<MarginNote>` in the right column. Hovering either side highlights both via the shared `active` index.

The redline underline animation is CSS-only — see `.ink-underline.animate` in [`web/app/globals.css`](web/app/globals.css). The stagger is just `--draw-delay` set per-span based on its index.

### Web config

| File | Purpose |
| --- | --- |
| [`web/package.json`](web/package.json) | Deps. Pinned to Next 15, React 19, Anthropic SDK ≥ 0.30, motion. |
| [`web/tailwind.config.ts`](web/tailwind.config.ts) | The full color palette (parchment, ink, redline, tobacco, gold, sage), custom fonts, and the draw-underline keyframes. |
| [`web/tsconfig.json`](web/tsconfig.json) | Standard Next.js TS config with `@/*` path alias. |
| [`web/.env.local.example`](web/.env.local.example) | Template for the local API key. |

---

## What's shared and what's duplicated

| Concept | CLI location | Web location |
| --- | --- | --- |
| System prompt | [`SYSTEM_PROMPT`](redline.py#L72) | [`SYSTEM_PROMPT`](web/lib/redline.ts#L4) |
| User prompt builder | [`build_user_prompt`](redline.py#L108) | [`buildUserPrompt`](web/lib/redline.ts#L36) |
| Compact playbook | [`_compact_clause`](redline.py#L96) | [`compactClause`](web/lib/redline.ts#L25) |
| RTF stripper | [`_strip_rtf`](redline.py#L39) | [`stripRtf`](web/lib/strip-rtf.ts#L12) |
| Snippet validator | [`validate_and_clean`](redline.py#L237) | [`runRedline`](web/lib/redline.ts#L69) (inline) |
| Playbook data | [`playbook.json`](playbook.json) (root) | [`web/lib/playbook.json`](web/lib/playbook.json) (copy) |

If you ever change the prompt or validator logic, **change both**. The duplication is intentional — having the CLI deliverable run with zero dependencies was worth more than DRY for this scope.

---

## Reading order for a cold reviewer

If you've never seen this code before and want to grok it in 15 minutes:

1. [`README.md`](README.md) — what it is, how to run it.
2. [`redline.py`](redline.py) — the actual prompt, the validator, the contract with the model. Everything else is a wrapper around this.
3. [`evaluate.py`](evaluate.py) — read `pair_score` and `greedy_match`. That's the whole evaluation methodology.
4. [`expected_output.json`](expected_output.json) — the ground truth shape.
5. [`web/lib/redline.ts`](web/lib/redline.ts) — confirm it's the same logic in TS.
6. [`web/components/Reader.tsx`](web/components/Reader.tsx) — the only non-trivial UI code; everything else is layout.

Skip on a first pass: `Hero.tsx`, `Header.tsx`, `Seal.tsx`, `Intake.tsx`, `Processing.tsx`, anything in `globals.css`. They're styling, not logic.
