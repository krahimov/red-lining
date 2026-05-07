"use client";
import { useCallback, useRef, useState } from "react";
import { motion } from "motion/react";

const SAMPLE_HINT =
  "Plain-text NDAs only (.txt). Around 500–5,000 words works best.";

type Props = {
  onSubmit: (text: string, name: string) => void;
  isProcessing: boolean;
  loadSample: () => Promise<{ text: string; name: string }>;
};

export function Intake({ onSubmit, isProcessing, loadSample }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const readFile = useCallback(async (file: File) => {
    setError(null);
    if (!file.name.match(/\.(txt|md|text)$/i) && file.type !== "text/plain") {
      setError(`Plain text only — ${file.name} isn't a .txt file.`);
      return;
    }
    const text = await file.text();
    if (text.trim().length < 100) {
      setError("That document looks too short to redline.");
      return;
    }
    onSubmit(text, file.name);
  }, [onSubmit]);

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
                  onSubmit(text, name);
                }}
                className="border border-ink/40 text-ink px-6 py-3 rounded-sm font-mono text-xs uppercase tracking-widest hover:border-ink hover:bg-ink/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Try the sample NDA
              </button>
            </div>

            <input
              ref={inputRef}
              type="file"
              accept=".txt,.md,.text,text/plain"
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

        <div className="mt-10 grid grid-cols-1 md:grid-cols-3 gap-8 text-sm">
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
