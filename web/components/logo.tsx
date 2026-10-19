export function Logo({ className = "", tagline }: { className?: string; tagline?: string }) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg width="34" height="24" viewBox="0 0 34 24" aria-hidden="true" focusable="false">
        <defs><linearGradient id="setu-g" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stopColor="#4fa3ff" /><stop offset="1" stopColor="#1a5fdb" /></linearGradient></defs>
        <path d="M2 20C5 9 12 4 17 4s12 5 15 16" fill="none" stroke="url(#setu-g)" strokeWidth="4" strokeLinecap="round" />
        <path d="M1 21h32" stroke="currentColor" strokeOpacity=".9" strokeWidth="2" strokeLinecap="round" />
        <path d="M10 21v-6M17 21V9M24 21v-6" stroke="currentColor" strokeOpacity=".7" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
      <span className="leading-tight">
        <span className="block text-xl font-bold tracking-tight">Setu <span lang="zh-CN">桥</span></span>
        {tagline ? <span className="block text-[11px] font-medium opacity-80">{tagline}</span> : null}
      </span>
    </span>
  );
}
