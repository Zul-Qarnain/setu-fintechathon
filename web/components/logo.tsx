export function Logo({ className = "" }: { className?: string }) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden="true" focusable="false">
        <rect width="32" height="32" rx="7" fill="#0b7a5a" />
        <path d="M4 22h24" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
        <path d="M7 22c0-6 4-10 9-10s9 4 9 10" fill="none" stroke="#fde9b3" strokeWidth="2.2" strokeLinecap="round" />
        <path d="M11 22v-5M16 22v-8M21 22v-5" stroke="#fff" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className="text-lg font-bold tracking-tight">Setu <span lang="zh-CN">桥</span></span>
    </span>
  );
}
