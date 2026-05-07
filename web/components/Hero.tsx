"use client";
import { motion } from "motion/react";

export function Hero() {
  return (
    <section className="max-w-[1100px] mx-auto px-8 pt-20 pb-12">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
        className="diamond-divider mb-6"
      >
        <span className="text-xs font-mono uppercase tracking-widest text-tobacco">
          Volume I &nbsp;·&nbsp; A second reading
        </span>
      </motion.div>

      <motion.h1
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
        className="font-display text-ink text-center"
        style={{
          fontSize: "clamp(3.5rem, 9vw, 7rem)",
          fontWeight: 600,
          letterSpacing: "-0.04em",
          lineHeight: 0.92,
          fontVariationSettings: "'opsz' 144, 'SOFT' 30, 'WONK' 1",
        }}
      >
        On the careful
        <br />
        <em
          style={{
            fontVariationSettings: "'opsz' 144, 'SOFT' 100, 'WONK' 1",
            color: "#b91528",
          }}
        >
          reading
        </em>{" "}
        of contracts.
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
        className="mt-10 text-center text-lg md:text-xl text-ink/80 font-body italic max-w-[640px] mx-auto leading-relaxed"
      >
        An attentive reader for your NDAs. Upload a draft, and receive marginal notes against
        a structured playbook of clauses. Each annotation cites the offending sentence and
        proposes a fix.
      </motion.p>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.9, delay: 0.32 }}
        className="mt-10 flex items-center justify-center gap-6 text-[11px] font-mono uppercase tracking-widest text-muted"
      >
        <span>Powered by Claude Sonnet 4.6</span>
        <span className="text-tobacco">◆</span>
        <span>16-clause playbook</span>
        <span className="text-tobacco">◆</span>
        <span>One pass · One verdict</span>
      </motion.div>
    </section>
  );
}
