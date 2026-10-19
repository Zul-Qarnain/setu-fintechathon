"use client";
import { formatBdt, formatCny } from "@/lib/format";

export function Cny({ value, className = "", sans = false }: { value: string | null | undefined; className?: string; sans?: boolean }) {
  return <span className={`${sans ? "" : "font-mono"} tabular-nums ${className}`} lang="zh-CN">{formatCny(value)}</span>;
}
export function Bdt({ value, className = "", sans = false }: { value: string | null | undefined; className?: string; sans?: boolean }) {
  return <span className={`${sans ? "" : "font-mono"} tabular-nums ${className}`} lang="en-BD">{formatBdt(value)}</span>;
}
