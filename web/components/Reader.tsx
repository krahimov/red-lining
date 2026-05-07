"use client";
import { useMemo, useState } from "react";
import { motion } from "motion/react";
import type { Redline } from "@/lib/types";

type Span = { type: "text"; value: string } | {
  type: "redline";
  value: string;
  index: number;
  redline: Redline;
};

type Props = {
  document: string;
  documentName: string;
  redlines: Redline[];
};

function buildSpans(doc: string, redlines: Redline[]): Span[] {
  // Find first occurrence of each snippet, sort by position, drop overlaps.
  const placements = redlines
    .map((r, i) => {
      const idx = doc.indexOf(r.text_snippet);
      return idx === -1 ? null : { start: idx, end: idx + r.text_snippet.length, redline: r, originalIndex: i };
    })
    .filter((p): p is NonNullable<typeof p> => p !== null)
    .sort((a, b) => a.start - b.start);

  // Greedily drop placements that overlap an earlier placement.
  const kept: typeof placements = [];
  for (const p of placements) {
    if (kept.length === 0 || p.start >= kept[kept.length - 1].end) kept.push(p);
  }

  const spans: Span[] = [];
  let cursor = 0;
  kept.forEach((p, i) => {
    if (p.start > cursor) spans.push({ type: "text", value: doc.slice(cursor, p.start) });
    spans.push({
      type: "redline",
      value: doc.slice(p.start, p.end),
      index: i + 1,
      redline: p.redline,
    });
    cursor = p.end;
  });
  if (cursor < doc.length) spans.push({ type: "text", value: doc.slice(cursor) });
  return spans;
}

export function Reader({ document, documentName, redlines }: Props) {
  const spans = useMemo(() => buildSpans(document, redlines), [document, redlines]);
  const numbered = useMemo(
    () =>
      spans
        .filter((s): s is Extract<Span, { type: "redline" }> => s.type === "redline")
        .map((s) => ({ index: s.index, redline: s.redline })),
    [spans],
  );
  const [active, setActive] = useState<number | null>(null);

  return (
    <section className="max-w-[1400px] mx-auto px-8 py-12">
      <DocumentMasthead documentName={documentName} count={numbered.length} />

      <div className="mt-12 grid grid-cols-1 lg:grid-cols-[1fr_360px] gap-12">
        <article className="relative">
          <DocumentBody spans={spans} active={active} setActive={setActive} />
        </article>

        <aside className="relative">
          <div className="lg:sticky lg:top-24">
            <div className="text-[10px] font-mono uppercase tracking-widest text-tobacco mb-6 flex items-center gap-3">
              <span className="h-px flex-1 bg-tobacco/40" />
              Marginalia
              <span className="h-px flex-1 bg-tobacco/40" />
            </div>
            <ul className="space-y-7">
              {numbered.map(({ index, redline }) => (
                <MarginNote
                  key={index}
                  index={index}
                  redline={redline}
                  active={active === index}
                  onHover={() => setActive(index)}
                  onLeave={() => setActive(null)}
                />
              ))}
              {numbered.length === 0 && (
                <li className="text-sm italic text-ink/70">
                  No findings. The reviewer had nothing to add.
                </li>
              )}
            </ul>
          </div>
        </aside>
      </div>
    </section>
  );
}

function DocumentMasthead({ documentName, count }: { documentName: string; count: number }) {
  return (
    <div className="border-y-2 border-ink py-8 text-center relative">
      <div className="absolute top-2 left-1/2 -translate-x-1/2 w-1 h-1 bg-ink rounded-full" />
      <div className="text-[10px] font-mono uppercase tracking-widest text-tobacco mb-3">
        Opinion of Counsel
      </div>
      <h2
        className="font-display text-ink"
        style={{
          fontSize: "clamp(2.25rem, 5vw, 3.75rem)",
          fontVariationSettings: "'opsz' 144, 'SOFT' 30, 'WONK' 1",
          fontWeight: 600,
          letterSpacing: "-0.03em",
          lineHeight: 1,
        }}
      >
        {count > 0 ? "Findings of the Reviewer" : "No Objections to Raise"}
      </h2>
      <div className="mt-5 flex items-center justify-center gap-4 text-xs font-mono uppercase tracking-widest text-muted">
        <span>Document</span>
        <span className="text-ink not-italic font-mono normal-case tracking-normal text-sm">
          {documentName}
        </span>
        <span className="text-tobacco">◆</span>
        <span>{count} {count === 1 ? "finding" : "findings"}</span>
      </div>
    </div>
  );
}

function DocumentBody({
  spans,
  active,
  setActive,
}: {
  spans: Span[];
  active: number | null;
  setActive: (n: number | null) => void;
}) {
  return (
    <div className="font-body text-ink/95 text-[15px] leading-[1.85] whitespace-pre-wrap">
      {spans.map((span, i) => {
        if (span.type === "text") return <span key={i}>{span.value}</span>;
        return (
          <RedlinedRun
            key={i}
            index={span.index}
            value={span.value}
            active={active === span.index}
            onEnter={() => setActive(span.index)}
            onLeave={() => setActive(null)}
          />
        );
      })}
    </div>
  );
}

function RedlinedRun({
  index,
  value,
  active,
  onEnter,
  onLeave,
}: {
  index: number;
  value: string;
  active: boolean;
  onEnter: () => void;
  onLeave: () => void;
}) {
  const delay = 220 + index * 75;
  return (
    <span
      className={`relative ink-underline animate transition-colors ${
        active ? "bg-redline/8" : ""
      }`}
      style={{ ["--draw-delay" as never]: `${delay}ms` }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      {value}
      <motion.sup
        initial={{ opacity: 0, scale: 0.6, rotate: -10 }}
        animate={{ opacity: 1, scale: 1, rotate: -2 }}
        transition={{ delay: (delay + 600) / 1000, type: "spring", stiffness: 400, damping: 22 }}
        className="ml-1 mr-0.5 align-super"
      >
        <span className="seal">{index}</span>
      </motion.sup>
    </span>
  );
}

function MarginNote({
  index,
  redline,
  active,
  onHover,
  onLeave,
}: {
  index: number;
  redline: Redline;
  active: boolean;
  onHover: () => void;
  onLeave: () => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <motion.li
      initial={{ opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay: 0.4 + index * 0.08, duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className={`relative pl-6 border-l-2 transition-colors ${
        active ? "border-redline" : "border-tobacco/40"
      }`}
    >
      <div className="absolute -left-[11px] top-0">
        <span className="seal">{index}</span>
      </div>
      <div className="font-mono text-[10px] uppercase tracking-widest text-tobacco mb-1">
        Cited rule
      </div>
      <div
        className="font-display text-ink text-xl mb-3"
        style={{
          fontVariationSettings: "'opsz' 24, 'SOFT' 50, 'WONK' 1",
          fontWeight: 500,
          letterSpacing: "-0.01em",
          lineHeight: 1.15,
        }}
      >
        {redline.playbook_clause_reference}
      </div>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="text-[11px] font-mono uppercase tracking-widest text-redline hover:text-ink transition-colors flex items-center gap-2"
      >
        {open ? "▾ Hide proposed redraft" : "▸ Read proposed redraft"}
      </button>
      <motion.div
        initial={false}
        animate={{ height: open ? "auto" : 0, opacity: open ? 1 : 0 }}
        transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
        className="overflow-hidden"
      >
        <div className="pt-4 mt-3 border-t border-tobacco/30">
          <div className="font-mono text-[10px] uppercase tracking-widest text-tobacco mb-2">
            Drafted replacement
          </div>
          <p className="text-[13.5px] leading-[1.7] text-ink/90 italic whitespace-pre-wrap">
            {redline.suggested_fix}
          </p>
        </div>
      </motion.div>
    </motion.li>
  );
}
