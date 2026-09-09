import { type ReactNode } from "react";
import {
  BookMarked,
  BookOpen,
  Headphones,
  Home,
  Library,
  ListMusic,
  Search,
  Settings2,
  Sparkles,
  StickyNote,
  WandSparkles,
} from "lucide-react";
import { percentLabel, useProductState } from "./ProductState";

export type AppDestination =
  | "Home"
  | "Library"
  | "Create Audio"
  | "Bookmarks"
  | "Notes"
  | "Settings";

const navItems: Array<{ label: AppDestination; icon: typeof Home }> = [
  { label: "Home", icon: Home },
  { label: "Library", icon: Library },
  { label: "Create Audio", icon: WandSparkles },
  { label: "Settings", icon: Settings2 },
];

export function AppLayout({
  children,
  active = "Library",
  eyebrow,
  title,
  subtitle,
  compact = false,
}: {
  children: ReactNode;
  active?: AppDestination;
  eyebrow?: string;
  title?: string;
  subtitle?: string;
  compact?: boolean;
}) {
  const [product, updateProduct] = useProductState();
  return (
    <main
      className="min-h-[100dvh] overflow-hidden bg-[#241f23] text-[#eee4d9]"
      style={{ fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif" }}
    >
      <header className="flex h-[64px] items-center justify-between border-b border-[#3f353a] bg-[#2c262b] px-5 sm:px-8">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e4b06a] text-[#2b2020]">
            <Headphones size={18} strokeWidth={2.4} />
          </div>
          <div>
            <div className="text-[13px] font-bold tracking-[0.15em] text-[#f3e9de]">
              AUDIOBOOK <span className="text-[#e4b06a]">AI</span>
            </div>
            <div className="mt-0.5 hidden text-[9px] uppercase tracking-[0.2em] text-[#877b78] sm:block">
              your reading room
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[#a99d98]">
          <button type="button" aria-label="Search" className="rounded-lg p-2 hover:bg-[#40353a]">
            <Search size={17} />
          </button>
          <div className="hidden items-center gap-2 rounded-full border border-[#55464a] bg-[#342b30] px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#ad9a91] md:flex">
            <span className="h-1.5 w-1.5 rounded-full bg-[#86a88e]" />
            4/5 lanes healthy
          </div>
          <div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-[#765b54] text-[11px] font-bold text-[#f7dfc4]">
            RK
          </div>
        </div>
      </header>

      <div className="flex min-h-[calc(100dvh-64px)]">
        <aside className={`${compact ? "hidden" : "hidden sm:flex"} w-[228px] shrink-0 flex-col border-r border-[#42373b] bg-[#282328] p-4`}>
          <div className="mb-3 px-2 text-[9px] font-bold uppercase tracking-[0.22em] text-[#817574]">
            Navigate
          </div>
          {navItems.map(({ label, icon: Icon }) => (
            <button
              type="button"
              key={label}
              className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[11px] transition ${
                active === label
                  ? "bg-[#443238] text-[#f0d3ad]"
                  : "text-[#a29793] hover:bg-[#362e33] hover:text-[#ead8ca]"
              }`}
            >
              <Icon size={15} />
              {label}
              {label === "Library" && <span className="ml-auto text-[9px] text-[#817275]">6</span>}
            </button>
          ))}

          <div className="mt-6 border-t border-[#3e3438] pt-5">
            <div className="mb-3 px-2 text-[9px] font-bold uppercase tracking-[0.22em] text-[#817574]">
              This book
            </div>
            {[
              ["Read book", BookOpen],
              ["Bookmarks", BookMarked],
              ["Notes", StickyNote],
              ["Audio queue", ListMusic],
            ].map(([label, Icon]) => (
              <button
                type="button"
                key={label as string}
                className="mb-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[11px] text-[#a29793] hover:bg-[#362e33] hover:text-[#ead8ca]"
              >
                <Icon size={15} />
                {label as string}
              </button>
            ))}
          </div>

          <div className="mt-auto rounded-xl border border-[#4a3a3b] bg-[#34292d] p-3">
            <div className="flex items-center justify-between gap-3 text-[9px] font-bold uppercase tracking-[0.18em] text-[#95837c]">
              <span>Progress, kept separate</span>
              <span className="shrink-0 text-[#86a88e]">saved</span>
            </div>
            <div className="mt-3 flex items-end justify-between">
              <span className="font-serif text-[23px] text-[#efd2ae]">{percentLabel(product.readingProgress)}</span>
              <span className="text-[10px] text-[#968780]">reading</span>
            </div>
            <div className="mt-2 h-1 rounded-full bg-[#594145]">
              <div className="h-full rounded-full bg-[#d89c61]" style={{ width: `${product.readingProgress}%` }} />
            </div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-[#968780]">
              <span>Listening</span>
              <span className="text-[#d6b184]">{percentLabel(product.listeningProgress)}</span>
            </div>
            <div className="mt-2 h-1 rounded-full bg-[#594145]"><div className="h-full rounded-full bg-[#7ea286]" style={{ width: `${product.listeningProgress}%` }} /></div>
            <div className="mt-3 flex items-center justify-between text-[10px] text-[#968780]">
              <span>Audiobook</span>
              <span className="text-right text-[#d6b184]">{product.audiobookReadyCount} / {product.audiobookReadyTotal} ready</span>
            </div>
            <div className="mt-3 border-t border-[#49383c] pt-3 text-[9px] leading-relaxed text-[#8e7d79]">
              {product.activityLabel}
            </div>
          </div>
        </aside>

        <section className="min-w-0 flex-1 overflow-y-auto bg-[#2a2429]">
          <div className="mx-auto max-w-[1180px] px-5 pb-16 pt-8 sm:px-10 sm:pt-10">
            {(eyebrow || title) && (
              <div className="mb-8">
                {eyebrow && (
                  <div className="mb-3 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#b48e6c]">
                    <Sparkles size={14} />
                    {eyebrow}
                  </div>
                )}
                {title && (
                  <h1 className="font-serif text-[42px] leading-[0.98] tracking-[-0.03em] text-[#f2dfca] sm:text-[58px]">
                    {title}
                  </h1>
                )}
                {subtitle && <p className="mt-4 max-w-[620px] text-[13px] leading-relaxed text-[#a99a95]">{subtitle}</p>}
              </div>
            )}
            {children}
          </div>
        </section>
      </div>
    </main>
  );
}

export function BookCover({ label = "THE\nCARTOGRAPHER", large = false }: { label?: string; large?: boolean }) {
  return (
    <div
      className={`flex shrink-0 items-center justify-center whitespace-pre-line bg-[#b87350] text-center font-serif leading-[1.05] text-[#fbe4c6] shadow-[inset_8px_0_18px_rgba(60,27,18,.16),inset_-5px_0_10px_rgba(255,223,186,.12)] ${
        large ? "h-[230px] w-[154px] text-[15px]" : "h-[88px] w-[60px] text-[8px]"
      }`}
    >
      {label}
    </div>
  );
}

export function ProgressBar({ value, tone = "gold" }: { value: number; tone?: "gold" | "green" }) {
  return (
    <div className="h-1.5 overflow-hidden rounded-full bg-[#4e3d40]">
      <div
        className={`h-full rounded-full ${tone === "green" ? "bg-[#7ea286]" : "bg-[#d89c61]"}`}
        style={{ width: `${value}%` }}
      />
    </div>
  );
}