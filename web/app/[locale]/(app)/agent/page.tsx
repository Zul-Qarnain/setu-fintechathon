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
import { button, input } from "@/components/ui";
import { Icon } from "@/components/nav-icons";
import { useAuth } from "@/components/auth-provider";
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
  const { user } = useAuth();
  // Dashboard "Plan payment" deep link: /agent?q=… pre-fills (never auto-sends) the message.
  useEffect(() => { const q = new URLSearchParams(window.location.search).get("q"); if (q) setDraft(q.slice(0, 500)); }, []);

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

  const newChat = () => { setMsgs([]); setLatest(null); setDraft(""); clear(); };
  const initial = (user?.email[0] ?? "?").toUpperCase();
  const ICONS: Record<(typeof PROMPTS)[number], string> = { pay: "school", bdt: "swap", save: "shieldAlert", sms: "alert" };

  return (
    <>
      <PageHeader icon={<Icon name="agent" />} title={t("title")} subtitle={t("subtitle")}
        actions={<button type="button" onClick={newChat} className={button("ghost")} data-testid="new-chat"><Icon name="plus" className="h-4 w-4" />{t("newChat")}</button>} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,26rem)]">
        <section aria-label={t("chat")} className="flex min-h-[32rem] flex-col rounded-2xl border border-line bg-surface shadow-card">
          <div className="h-[min(40rem,calc(100dvh-17rem))] min-h-72 flex-1 space-y-5 overflow-y-auto overscroll-contain p-4 sm:p-5" role="log" aria-live="polite" aria-relevant="additions" aria-label={t("log")}>
            {msgs.length === 0 ? (
              <div className="grid h-full place-content-center justify-items-center gap-3 text-center">
                <span className="grid h-14 w-14 place-items-center rounded-2xl bg-bridge-50 text-bridge-600"><Icon name="agent" className="h-7 w-7" /></span>
                <p className="max-w-sm text-sm text-ink-600">{t("emptyChat")}</p>
              </div>
            ) : null}
            {msgs.map((m, i) => m.role === "user" ? (
              <div key={i} className="flex items-start justify-end gap-2.5">
                <div className="max-w-[85%] rounded-2xl rounded-tr-md bg-bridge-50 px-4 py-2.5 text-sm text-ink">
                  <p className="sr-only">{t("you")}:</p>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                </div>
                <span aria-hidden="true" className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-chrome text-xs font-semibold text-white dark:bg-cta">{initial}</span>
              </div>
            ) : (
              <div key={i} className="flex items-start gap-2.5">
                <span aria-hidden="true" className={`grid h-8 w-8 shrink-0 place-items-center rounded-full ${m.turn?.trace.tier === "T4" ? "bg-cinnabar-50 text-cinnabar-600" : "bg-bridge-50 text-bridge-600"}`}><Icon name={m.turn?.trace.tier === "T4" ? "shieldAlert" : "agent"} className="h-[18px] w-[18px]" /></span>
                <div className="min-w-0 max-w-[92%] flex-1 space-y-3">
                  <div className="inline-block rounded-2xl rounded-tl-md bg-sunken px-4 py-2.5 text-sm text-ink">
                    <p className="sr-only">{t("agentName")}:</p>
                    <p className="whitespace-pre-wrap">{m.text}</p>
                  </div>
                  {m.turn?.plan ? <PlanCard plan={m.turn.plan} /> : null}
                  {m.turn?.proposed_actions.map((a) => <ActionCard key={a.id} action={a} compact={false} />)}
                </div>
              </div>
            ))}
            {busy ? <p className="flex items-center gap-2 text-sm text-ink-600" role="status"><span className="h-2 w-2 animate-pulse rounded-full bg-cta" />{t("thinking")}</p> : null}
            <div ref={endRef} />
          </div>
          <div className="border-t border-line p-4 sm:p-5">
            {err ? <Banner tone="danger" className="mb-3">{err}</Banner> : null}
            <p className="sr-only">{t("try")}</p>
            <ul className="mb-3 flex flex-wrap gap-2">
              {PROMPTS.map((p) => <li key={p}><button type="button" disabled={busy} onClick={() => void send(t(`prompts.${p}`))} className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-left text-sm leading-5 font-medium text-ink hover:bg-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 disabled:opacity-50" data-testid={`prompt-${p}`}><Icon name={ICONS[p]} className="h-4 w-4 shrink-0 text-ink-600" /><span className="line-clamp-2">{t(`prompts.${p}`)}</span></button></li>)}
            </ul>
            <form onSubmit={onSubmit} className="space-y-3">
              <div className="flex flex-wrap items-center gap-2">
                <label htmlFor="doc" className="flex items-center gap-1.5 text-sm font-medium text-ink-700"><Icon name="paperclip" className="h-4 w-4" />{t("document")}</label>
                <select id="doc" value={docId} onChange={(e) => setDocId(e.target.value)} className={`${input} h-10 w-auto min-w-[12rem] max-w-full flex-1 py-1.5`}>
                  <option value="">{t("noDocument")}</option>
                  {docs.map((d) => <option key={d.id} value={d.id}>{d.filename} · {d.status}</option>)}
                </select>
                {docs.length === 0 ? <Link href="/documents" className="inline-flex min-h-10 items-center text-xs font-semibold text-bridge-700 underline">{t("goDocuments")}</Link> : null}
              </div>
              <div className="flex items-end gap-2 rounded-xl border border-line-strong bg-surface p-1.5 focus-within:ring-2 focus-within:ring-bridge-600">
                <label htmlFor="msg" className="sr-only">{t("message")}</label>
                <textarea id="msg" rows={1} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={onKey} placeholder={t("placeholder")} className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-2.5 py-2 text-sm text-ink placeholder:text-ink-500 focus:outline-none" aria-describedby="msg-h" />
                <button type="submit" disabled={busy || !draft.trim()} aria-label={t("send")} className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-cta text-white transition hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-bridge-600 focus-visible:ring-offset-2 disabled:opacity-40"><Icon name="send" className="h-[18px] w-[18px]" /></button>
              </div>
              <p id="msg-h" className="text-xs text-ink-600">{t("enterHint")}</p>
            </form>
          </div>
        </section>
        <div className="xl:sticky xl:top-20 xl:self-start"><TracePanel turn={latest} /></div>
      </div>
    </>
  );
}
