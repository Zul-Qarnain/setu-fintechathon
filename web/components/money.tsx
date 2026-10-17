"use client";
import { formatBdt, formatCny } from "@/lib/format";

export function Cny({ value, className = "" }: { value: string | null | undefined; className?: string }) {
  return <span className={`tabular-nums ${className}`} lang="zh-CN">{formatCny(value)}</span>;
}
export function Bdt({ value, className = "" }: { value: string | null | undefined; className?: string }) {
  return <span className={`tabular-nums ${className}`} lang="en-BD">{formatBdt(value)}</span>;
}
