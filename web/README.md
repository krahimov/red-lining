# Redliner — Web

A Next.js companion to the redlining scripts. Upload an NDA, and the page renders
the document in an editorial layout with marginal notes citing the playbook
clause and a drafted replacement for each finding.

## Stack

- Next.js 15 (App Router) + React 19 + TypeScript
- Tailwind CSS for utilities; custom CSS for the editorial details
- Motion (Framer Motion) for staged reveals
- Anthropic SDK — server-side `/api/redline` route mirrors the Python `redline.py` logic
- Fonts: **Fraunces** (display, with WONK + SOFT axes), **Source Serif 4** (body), **JetBrains Mono** (technical)

## Setup

```bash
cd web
npm install
cp .env.local.example .env.local      # set ANTHROPIC_API_KEY
npm run dev                           # http://localhost:3000
```

## Build

```bash
npm run build && npm start
```

## How it works

1. The user uploads a `.txt` NDA (or clicks "Try the sample NDA").
2. `POST /api/redline` sends the document + `lib/playbook.json` to Claude Sonnet 4.6
   using the same prompt and validation rules as the Python script.
3. The response is rendered in a three-column editorial layout: line numbers,
   document body, and marginal notes. Each redlined snippet gets a numbered
   wax-seal badge that pairs to its margin note. Hover either side to highlight.

## Design intent

Most legal-tech UIs default to corporate blue. This one commits to a printed-brief
aesthetic — parchment background, paired serifs, stamped seals, marginalia that
fade in like an editor's pen marks.
