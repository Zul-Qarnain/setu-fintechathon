"use client";
import { useEffect, useState } from "react";

/** Re-renders every `ms` (default 1s) with the current epoch ms. Paused when reduced-motion is irrelevant (timers are informational). */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState<number>(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}
