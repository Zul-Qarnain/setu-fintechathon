import type { ReactNode } from "react";
import { Logo } from "./logo";
import { LocaleToggle } from "./locale-toggle";

export function AuthLayout({ title, subtitle, children, aside }: { title: string; subtitle?: string; children: ReactNode; aside?: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_28rem]">
      <main id="main" className="flex flex-col px-5 py-6 sm:px-10">
        <div className="flex items-center justify-between"><Logo /><LocaleToggle /></div>
        <div className="mx-auto my-auto w-full max-w-md py-10">
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          {subtitle ? <p className="mt-2 text-ink-600">{subtitle}</p> : null}
          <div className="mt-6">{children}</div>
        </div>
        <p className="text-xs text-ink-600" role="note">SYNTHETIC DEMO DATA · Sandbox bank — Setu never holds funds.</p>
      </main>
      <aside className="hidden bg-chrome p-10 text-white lg:flex lg:flex-col lg:justify-center" aria-label="About">{aside}</aside>
    </div>
  );
}
