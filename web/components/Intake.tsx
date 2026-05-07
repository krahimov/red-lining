"use client";
import { useCallback, useRef, useState } from "react";
import { motion } from "motion/react";

const SAMPLE_HINT =
  "Plain-text or RTF NDAs (.txt, .rtf). Around 500-5,000 words works best.";

export type CustomPlaybook = {
  name: string;
  data: unknown;
  clauseCount: number;
};

type Props = {
  onSubmit: (text: string, name: string, playbook: CustomPlaybook | null) => void;
  isProcessing: boolean;
  loadSample: () => Promise<{ text: string; name: string }>;
};

export function Intake({ onSubmit, isProcessing, loadSample }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const playbookInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [playbookDragOver, setPlaybookDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [customPlaybook, setCustomPlaybook] = useState<CustomPlaybook | null>(null);
  const [playbookError, setPlaybookError] = useState<string | null>(null);

  const readFile = useCallback(async (file: File) => {
    setError(null);
    // If the user dropped a .json on the document zone, route it to the
    // playbook handler instead of rejecting -- that's almost always what
    // they meant.
    if (/\.json$/i.test(file.name)) {
      await readPlaybookInner(file);
      return;
    }
    const isAccepted = /\.(txt|md|text|rtf)$/i.test(file.name)
      || file.type === "text/plain"
      || file.type === "application/rtf"
      || file.type === "text/rtf";
    if (!isAccepted) {
      setError(`Text or RTF only — ${file.name} isn't supported.`);
      return;
    }
    const text = await file.text();
    if (text.trim().length < 100) {
      setError("That document looks too short to redline.");
      return;
    }
    onSubmit(text, file.name, customPlaybook);
  }, [onSubmit, customPlaybook]);

  const readPlaybookInner = useCallback(async (file: File) => {
    setPlaybookError(null);
    if (!/\.json$/i.test(file.name)) {
      setPlaybookError(`Playbook must be a .json file (got ${file.name}).`);
      return;
    }
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (!Array.isArray(data) || data.length === 0) {
        throw new Error("Playbook must be a non-empty JSON array.");
      }
      const allHaveClauses = data.every(
        (c) => c && typeof c === "object" && typeof c.clause === "string",
      );
      if (!allHaveClauses) {
        throw new Error('Every entry must have a "clause" string field.');
      }
      setCustomPlaybook({ name: file.name, data, clauseCount: data.length });
    } catch (err) {
      setPlaybookError(err instanceof Error ? err.message : "Couldn't read playbook.");
    }
  }, []);
  const readPlaybook = readPlaybookInner;

  return (
    <section className="max-w-[820px] mx-auto px-8 pb-24">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) await readFile(file);
          }}
          className={`relative border-2 border-dashed rounded-sm bg-surface/50 transition-colors ${
            dragOver ? "border-redline bg-redline/5" : "border-tobacco/40 drop-idle"
          }`}
        >
          <div className="px-12 py-14 text-center">
            <div className="text-[10px] font-mono uppercase tracking-widest text-tobacco mb-6">
              ▸ Document Intake ◂
            </div>
            <div
              className="font-display text-ink mb-3"
              style={{
                fontSize: "clamp(1.5rem, 3vw, 2.25rem)",
                fontVariationSettings: "'opsz' 36, 'SOFT' 50, 'WONK' 0",
                fontWeight: 500,
                letterSpacing: "-0.02em",
              }}
            >
              Deliver your draft for review.
            </div>
            <p className="text-ink/70 italic mb-8 text-sm">{SAMPLE_HINT}</p>

            <div className="flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                disabled={isProcessing}
                onClick={() => inputRef.current?.click()}
                className="bg-ink text-parchment px-6 py-3 rounded-sm font-mono text-xs uppercase tracking-widest hover:bg-redline transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Choose a file
              </button>
              <span className="text-tobacco text-xs">or</span>
              <button
                type="button"
                disabled={isProcessing}
                onClick={async () => {
                  const { text, name } = await loadSample();
                  onSubmit(text, name, customPlaybook);
                }}
                className="border border-ink/40 text-ink px-6 py-3 rounded-sm font-mono text-xs uppercase tracking-widest hover:border-ink hover:bg-ink/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Try the sample NDA
              </button>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept=".txt,.md,.text,.rtf,text/plain,application/rtf,text/rtf"
              className="hidden"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) await readFile(file);
                e.target.value = "";
              }}
            />

            {error && (
              <p className="mt-6 text-sm text-redline italic">{error}</p>
            )}
          </div>

          {/* Decorative corner marks — like a printed form */}
          <CornerMark className="top-2 left-2" />
          <CornerMark className="top-2 right-2 rotate-90" />
          <CornerMark className="bottom-2 left-2 -rotate-90" />
          <CornerMark className="bottom-2 right-2 rotate-180" />
        </div>

        <PlaybookDropZone
          custom={customPlaybook}
          dragOver={playbookDragOver}
          error={playbookError}
          onDragOver={(e) => {
            e.preventDefault();
            setPlaybookDragOver(true);
          }}
          onDragLeave={() => setPlaybookDragOver(false)}
          onDrop={async (e) => {
            e.preventDefault();
            setPlaybookDragOver(false);
            const file = e.dataTransfer.files?.[0];
            if (file) await readPlaybook(file);
          }}
          onPick={() => playbookInputRef.current?.click()}
          onClear={() => {
            setCustomPlaybook(null);
            setPlaybookError(null);
          }}
        />
        <input
          ref={playbookInputRef}
          type="file"
          accept=".json,application/json"
          className="hidden"
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (file) await readPlaybook(file);
            e.target.value = "";
          }}
        />

        <div className="mt-12 grid grid-cols-1 md:grid-cols-3 gap-8 text-sm">
          <Pillar n="I" title="Read">
            The document is ingested and laid out for examination, line by line.
          </Pillar>
          <Pillar n="II" title="Review">
            Each clause is checked against a 16-rule playbook of red flags,
            ideal language, and acceptable fallbacks.
          </Pillar>
          <Pillar n="III" title="Annotate">
            Findings are returned as marginal notes — the offending text, the
            cited rule, and a drafted replacement.
          </Pillar>
        </div>
      </motion.div>
    </section>
  );
}

function PlaybookDropZone({
  custom,
  dragOver,
  error,
  onDragOver,
  onDragLeave,
  onDrop,
  onPick,
  onClear,
}: {
  custom: CustomPlaybook | null;
  dragOver: boolean;
  error: string | null;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: () => void;
  onDrop: (e: React.DragEvent) => void;
  onPick: () => void;
  onClear: () => void;
}) {
  return (
    <div className="mt-6">
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        className={`relative border border-dashed rounded-sm transition-colors px-6 py-5 ${
          dragOver
            ? "border-redline bg-redline/5"
            : custom
            ? "border-tobacco/60 bg-surface/40"
            : "border-tobacco/40 bg-surface/30"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <PlaybookIcon active={!!custom} />
            <div className="min-w-0">
              <div className="font-mono text-[10px] uppercase tracking-widest text-tobacco mb-0.5">
                Playbook {custom ? "(custom)" : "(optional)"}
              </div>
              {custom ? (
                <div className="text-sm text-ink truncate">
                  <span className="font-mono">{custom.name}</span>
                  <span className="text-muted italic ml-2">
                    · {custom.clauseCount} {custom.clauseCount === 1 ? "clause" : "clauses"} loaded
                  </span>
                </div>
              ) : (
                <div className="text-sm text-ink">
                  Using bundled <span className="text-muted italic">· 16-clause NDA standard</span>
                </div>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {custom && (
              <button
                type="button"
                onClick={onClear}
                className="border border-ink/30 text-ink/80 px-3 py-2 rounded-sm font-mono text-[10px] uppercase tracking-widest hover:border-redline hover:text-redline transition-colors"
              >
                ✕ Reset
              </button>
            )}
            <button
              type="button"
              onClick={onPick}
              className="bg-tobacco text-parchment px-4 py-2 rounded-sm font-mono text-[10px] uppercase tracking-widest hover:bg-ink transition-colors"
            >
              {custom ? "Replace .json" : "Upload .json"}
            </button>
          </div>
        </div>
        {!custom && (
          <p className="mt-3 text-xs text-muted italic">
            Or drag a <span className="font-mono not-italic">.json</span> playbook into this box.
            Each entry must have a <span className="font-mono not-italic">clause</span> name.
          </p>
        )}
      </div>
      {error && (
        <p className="mt-2 text-xs italic text-redline">{error}</p>
      )}
    </div>
  );
}

function PlaybookIcon({ active }: { active: boolean }) {
  return (
    <svg
      width={28}
      height={28}
      viewBox="0 0 32 32"
      fill="none"
      stroke={active ? "#b91528" : "#8b6f47"}
      strokeWidth="1.4"
      aria-hidden="true"
    >
      <rect x="6" y="4" width="20" height="24" rx="1" />
      <line x1="10" y1="10" x2="22" y2="10" />
      <line x1="10" y1="14" x2="22" y2="14" />
      <line x1="10" y1="18" x2="18" y2="18" />
      <line x1="10" y1="22" x2="20" y2="22" />
    </svg>
  );
}

function CornerMark({ className }: { className?: string }) {
  return (
    <svg
      className={`absolute w-3 h-3 text-tobacco/60 ${className}`}
      viewBox="0 0 12 12"
      fill="none"
      stroke="currentColor"
      strokeWidth="1"
    >
      <path d="M0 3 L0 0 L3 0" />
    </svg>
  );
}

function Pillar({ n, title, children }: { n: string; title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-tobacco/30 pt-4">
      <div className="font-mono text-[10px] uppercase tracking-widest text-tobacco mb-2">
        Step {n}
      </div>
      <div
        className="font-display text-ink text-2xl mb-2"
        style={{ fontVariationSettings: "'opsz' 36, 'SOFT' 100, 'WONK' 1", fontWeight: 500 }}
      >
        {title}
      </div>
      <p className="text-ink/70 leading-relaxed">{children}</p>
    </div>
  );
}
