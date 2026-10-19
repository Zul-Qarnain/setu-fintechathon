import type { ReactNode } from "react";

export function PageHeader({ title, subtitle, actions, icon }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; icon?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div className="flex min-w-0 items-start gap-3">
        {icon ? <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-bridge-50 text-bridge-600">{icon}</span> : null}
        <div className="min-w-0">
          <h1 className="text-2xl font-bold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
          {subtitle ? <p className="mt-1 max-w-2xl text-sm text-ink-600">{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ children, className = "", as: Tag = "section", ...rest }: { children: ReactNode; className?: string; as?: "section" | "div" | "article" | "li" | "aside" } & React.HTMLAttributes<HTMLElement>) {
  return <Tag className={`rounded-2xl border border-line bg-surface p-4 shadow-card sm:p-5 ${className}`} {...rest}>{children}</Tag>;
}

/** Card title row: tinted icon tile + title (+ subtitle) + optional right slot. */
export function CardHead({ icon, title, sub, right, id, tone = "blue" }: { icon?: ReactNode; title: ReactNode; sub?: ReactNode; right?: ReactNode; id?: string; tone?: "blue" | "green" | "violet" | "amber" | "red" }) {
  const tile = { blue: "bg-bridge-50 text-bridge-600", green: "bg-jade-50 text-jade-600", violet: "bg-violet-50 text-violet-600", amber: "bg-amber-50 text-amber-600", red: "bg-cinnabar-50 text-cinnabar-600" }[tone];
  return (
    <div className="flex items-start gap-3">
      {icon ? <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${tile}`}>{icon}</span> : null}
      <div className="min-w-0 flex-1">
        <h2 id={id} className="text-lg font-semibold leading-6 text-ink">{title}</h2>
        {sub ? <p className="mt-0.5 text-sm text-ink-600">{sub}</p> : null}
      </div>
      {right ? <div className="shrink-0">{right}</div> : null}
    </div>
  );
}
