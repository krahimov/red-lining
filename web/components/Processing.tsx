"use client";
import { useEffect, useState } from "react";
import { motion } from "motion/react";

const STAGES = [
  { id: 0, label: "Ingesting the manuscript" },
  { id: 1, label: "Marking against the playbook" },
  { id: 2, label: "Drafting marginal notes" },
];

export function Processing() {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setStage((s) => Math.min(s + 1, STAGES.length - 1));
    }, 2200);
    return () => clearInterval(interval);
  }, []);

  return (
    <motion.section
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.5 }}
      className="max-w-[820px] mx-auto px-8 py-24 text-center"
    >
      <div className="diamond-divider mb-8">
        <span className="text-xs font-mono uppercase tracking-widest text-tobacco">
          In session
        </span>
      </div>

      <h2
        className="font-display text-ink text-4xl md:text-5xl"
        style={{
          fontVariationSettings: "'opsz' 96, 'SOFT' 50, 'WONK' 1",
          fontWeight: 500,
          letterSpacing: "-0.02em",
        }}
      >
        The reviewer is reading.
      </h2>
      <p className="mt-6 text-ink/70 italic">
        It typically takes around fifteen seconds.
      </p>

      <div className="mt-14 flex flex-col items-center gap-6">
        <div className="flex items-center gap-3">
          <div className="ink-dot" style={{ animationDelay: "0ms" }} />
          <div className="ink-dot" style={{ animationDelay: "200ms" }} />
          <div className="ink-dot" style={{ animationDelay: "400ms" }} />
        </div>

        <div className="flex flex-col gap-3 text-sm font-mono uppercase tracking-widest text-muted">
          {STAGES.map((s, i) => (
            <motion.div
              key={s.id}
              initial={{ opacity: 0.2 }}
              animate={{ opacity: i <= stage ? 1 : 0.2 }}
              transition={{ duration: 0.6 }}
              className="flex items-center gap-3"
            >
              <span className={i <= stage ? "text-redline" : "text-muted"}>
                {i < stage ? "✓" : i === stage ? "▸" : "○"}
              </span>
              <span className={i === stage ? "text-ink" : ""}>{s.label}</span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.section>
  );
}
