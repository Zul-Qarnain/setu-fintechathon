import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/700.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Setu 桥",
  description: "A guarded cross-border finance agent for South Asian students in China. Synthetic demo data; sandbox bank.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return children;
}
