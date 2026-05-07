"use client";
import { useCallback, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Header } from "@/components/Header";
import { Hero } from "@/components/Hero";
import { Intake } from "@/components/Intake";
import { Processing } from "@/components/Processing";
import { Reader } from "@/components/Reader";
import type { Redline } from "@/lib/types";

type Phase = "intake" | "processing" | "results" | "error";

type Submission = {
  document: string;
  documentName: string;
  redlines: Redline[];
};

export default function Page() {
  const [phase, setPhase] = useState<Phase>("intake");
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [error, setError] = useState<string | null>(null);
  const caseNo = useCaseNumber(submission?.documentName);

  const reset = useCallback(() => {
    setPhase("intake");
    setSubmission(null);
    setError(null);
  }, []);

  const submit = useCallback(async (document: string, name: string) => {
    setPhase("processing");
    setError(null);
    try {
      const res = await fetch("/api/redline", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ document }),
      });
      if (!res.ok) {
        const payload = await res.json().catch(() => ({}));
        throw new Error(payload.error ?? `Server returned ${res.status}`);
      }
      const data = (await res.json()) as { redlines: Redline[] };
      setSubmission({ document, documentName: name, redlines: data.redlines });
      setPhase("results");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
      setPhase("error");
    }
  }, []);

  const loadSample = useCallback(async () => {
    const res = await fetch("/sample.txt");
    const text = await res.text();
    return { text, name: "bad_document.txt (sample NDA)" };
  }, []);

  return (
    <div className="min-h-screen vignette relative">
      <Header caseNo={caseNo} />

      <AnimatePresence mode="wait">
        {phase === "intake" && (
          <motion.div
            key="intake"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.4 }}
          >
            <Hero />
            <Intake onSubmit={submit} isProcessing={false} loadSample={loadSample} />
          </motion.div>
        )}
        {phase === "processing" && <Processing key="processing" />}
        {phase === "results" && submission && (
          <motion.div
            key="results"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
          >
            <Reader
              document={submission.document}
              documentName={submission.documentName}
              redlines={submission.redlines}
            />
            <div className="max-w-[1400px] mx-auto px-8 pb-20">
              <div className="diamond-divider mb-6">
                <span className="font-display text-tobacco">◆ ◆ ◆</span>
              </div>
              <div className="text-center">
                <button
                  type="button"
                  onClick={reset}
                  className="border border-ink/40 text-ink px-6 py-3 rounded-sm font-mono text-xs uppercase tracking-widest hover:border-ink hover:bg-ink/5 transition-colors"
                >
                  Submit another draft
                </button>
              </div>
            </div>
          </motion.div>
        )}
        {phase === "error" && (
          <motion.section
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="max-w-[640px] mx-auto px-8 py-24 text-center"
          >
            <div className="text-[10px] font-mono uppercase tracking-widest text-redline mb-3">
              The reviewer paused
            </div>
            <h2
              className="font-display text-ink text-3xl md:text-4xl"
              style={{
                fontVariationSettings: "'opsz' 96, 'SOFT' 50, 'WONK' 1",
                fontWeight: 500,
              }}
            >
              Something prevented a verdict.
            </h2>
            <p className="mt-6 text-ink/80 italic">{error}</p>
            <button
              type="button"
              onClick={reset}
              className="mt-10 bg-ink text-parchment px-6 py-3 rounded-sm font-mono text-xs uppercase tracking-widest hover:bg-redline transition-colors"
            >
              Begin again
            </button>
          </motion.section>
        )}
      </AnimatePresence>

      <Footer />
    </div>
  );
}

function Footer() {
  return (
    <footer className="border-t border-tobacco/30 mt-16">
      <div className="max-w-[1400px] mx-auto px-8 py-8 flex flex-col md:flex-row items-center justify-between gap-3 text-[11px] font-mono uppercase tracking-widest text-muted">
        <span>Redliner · Office of the Reviewer</span>
        <span>Bound in {new Date().getFullYear()} · Set in Fraunces &amp; Source Serif</span>
      </div>
    </footer>
  );
}

function useCaseNumber(name?: string): string {
  if (!name) return "0001-A";
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return String(h).padStart(4, "0").slice(0, 4) + "-A";
}
