"use client";
import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Link } from "@/i18n/routing";
import { PageHeader } from "@/components/page-header";
import { Banner } from "@/components/banner";
import { PlanCard } from "@/components/plan-card";
import { TracePanel } from "@/components/trace-panel";
import { ActionCard } from "@/components/action-card";
import { useApiError } from "@/components/use-api-error";
import { button, input, label } from "@/components/ui";
import { api } from "@/lib/api";
import { listSessionDocs, type SessionDoc } from "@/lib/session-docs";
import type { ChatResponse } from "@/lib/types";

interface Msg { role: "user" | "agent"; text: string; turn?: ChatResponse }

const PROMPTS = ["pay", "bdt", "save", "sms"] as const;

export default function AgentPage() {
  const t = useTranslations("agent");
  const locale = useLocale();
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState<SessionDoc[]>([]);
  const [docId, setDocId] = useState("");
  const [latest, setLatest] = useState<ChatResponse | null>(null);
  const [err, fail, clear] = useApiError();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { const d = listSessionDocs(); setDocs(d); if (d[0]) setDocId(d[0].id); }, []);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" }); }, [msgs, busy]);

  async function send(text: string) {
    const message = text.trim();
    if (!message || busy) return;
    clear(); setBusy(true); setDraft("");
    setMsgs((m) => [...m, { role: "user", text: message }]);
    try {
      const r = await api.chat({ message, locale, ...(docId ? { document_id: docId } : {}) });
      setMsgs((m) => [...m, { role: "agent", text: r.reply, turn: r }]);
      setLatest(r);
    } catch (e) { fail(e); } finally { setBusy(false); }
  }
  const onSubmit = (e: FormEvent) => { e.preventDefault(); void send(draft); };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } };

  return (
    <>
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,28rem)]">
        <section aria-label={t("chat")} className="flex min-h-[32rem] flex-col rounded-xl border border-line bg-surface shadow-card">
          <div className="h-[min(34rem,calc(100dvh-18rem))] min-h-64 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4" role="log" aria-live="polite" aria-relevant="additions" aria-label={t("log")}>
            {msgs.length === 0 ? <p className="text-sm text-ink-600">{t("emptyChat")}</p> : null}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                <div className={`max-w-[92%] space-y-3 rounded-2xl px-4 py-2.5 text-sm ${m.role === "user" ? "bg-primary text-white" : "border border-line bg-paper text-ink"}`}>
                  <p className="sr-only">{m.role === "user" ? t("you") : t("agentName")}:</p>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.turn?.plan ? <PlanCard plan={m.turn.plan} /> : null}
                  {m.turn?.proposed_actions.map((a) => <ActionCard key={a.id} action={a} compact={false} />)}
                </div>
              </div>
            ))}
            {busy ? <p className="text-sm text-ink-600" role="status">{t("thinking")}</p> : null}
            <div ref={endRef} />
          </div>
          <div className="border-t border-line p-4">
            {err ? <Banner tone="danger" className="mb-3">{err}</Banner> : null}
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-600">{t("try")}</p>
            <ul className="mb-3 flex flex-wrap gap-2">
              {PROMPTS.map((p) => <li key={p}><button type="button" disabled={busy} onClick={() => void send(t(`prompts.${p}`))} className="min-h-11 rounded-full border border-line bg-surface px-4 py-2 text-left text-sm leading-5 font-medium text-ink hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 disabled:opacity-50" data-testid={`prompt-${p}`}>{t(`prompts.${p}`)}</button></li>)}
            </ul>
            <form onSubmit={onSubmit} className="space-y-3">
              <div>
                <label htmlFor="doc" className={label}>{t("document")}</label>
                <select id="doc" value={docId} onChange={(e) => setDocId(e.target.value)} className={input}>
                  <option value="">{t("noDocument")}</option>
                  {docs.map((d) => <option key={d.id} value={d.id}>{d.filename} · {d.status}</option>)}
                </select>
                {docs.length === 0 ? <p className="mt-1 text-xs text-ink-600">{t("noDocsHint")} <Link href="/documents" className="font-semibold text-bridge-700 underline">{t("goDocuments")}</Link></p> : null}
              </div>
              <div>
                <label htmlFor="msg" className={label}>{t("message")}</label>
                <textarea id="msg" rows={3} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} className={input} aria-describedby="msg-h" />
                <p id="msg-h" className="mt-1 text-xs text-ink-600">{t("enterHint")}</p>
              </div>
              <button type="submit" disabled={busy || !draft.trim()} className={button("primary")}>{t("send")}</button>
            </form>
          </div>
        </section>
        <div className="xl:sticky xl:top-20 xl:self-start"><TracePanel turn={latest} /></div>
      </div>
    </>
  );
}
