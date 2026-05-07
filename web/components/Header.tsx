import { Seal } from "./Seal";

export function Header({ caseNo }: { caseNo?: string }) {
  return (
    <header className="border-b border-tobacco/30 bg-parchment/60 backdrop-blur-sm sticky top-0 z-30">
      <div className="max-w-[1400px] mx-auto px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Seal size={36} />
          <div>
            <div className="font-display font-black tracking-tight text-ink leading-none text-xl">
              Redliner
            </div>
            <div className="text-[10px] font-mono uppercase tracking-widest text-muted mt-0.5">
              Office of the Reviewer
            </div>
          </div>
        </div>
        <div className="hidden md:flex items-center gap-6 text-[11px] font-mono uppercase tracking-widest text-muted">
          <span>Case No. {caseNo ?? "—"}</span>
          <span>·</span>
          <span>Filed {new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</span>
        </div>
      </div>
    </header>
  );
}
