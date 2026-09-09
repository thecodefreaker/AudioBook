import { useState } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  ChevronRight,
  Clock3,
  Headphones,
  MoreHorizontal,
  Play,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { AppLayout, BookCover, ProgressBar } from "./_shared/AppLayout";

const activities = [
  { chapter: "Chapter 02", title: "A House of Blue Light", detail: "Finished reading · 24 min", time: "Yesterday", tone: "read" },
  { chapter: "Chapter 01", title: "The Night Train", detail: "Listened in Hindi · Hinglish", time: "Monday", tone: "listen" },
  { chapter: "Chapter 03", title: "The Letter in the Wall", detail: "Narration draft ready", time: "Sunday", tone: "draft" },
];

export function BookOverview() {
  const [activeAction, setActiveAction] = useState<"read" | "listen" | "create" | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);

  const actionLabel =
    activeAction === "read"
      ? "Opening the reading room…"
      : activeAction === "listen"
        ? "Preparing your listening room…"
        : activeAction === "create"
          ? "Opening the audiobook studio…"
          : "";

  return (
    <AppLayout active="Library" eyebrow="Your library · Book overview" title="The Cartographer’s Daughter" subtitle="A quiet place to return to the story, pick up where you left off, and make it yours in another voice.">
      <div className="relative">
        <div className="pointer-events-none absolute -right-24 -top-28 h-80 w-80 rounded-full bg-[#9a5e4a]/10 blur-3xl" />

        <section className="relative grid gap-8 border-b border-[#44373a] pb-9 lg:grid-cols-[170px_minmax(0,1fr)_235px]">
          <div className="flex items-start justify-center lg:justify-start">
            <div className="relative">
              <BookCover large label={"THE\nCARTOGRAPHER’S\nDAUGHTER"} />
              <div className="absolute -bottom-3 -right-3 flex h-10 w-10 items-center justify-center rounded-full border-4 border-[#2a2429] bg-[#d89c61] text-[#30231f] shadow-lg">
                <BookOpen size={15} />
              </div>
            </div>
          </div>

          <div className="min-w-0">
            <div className="flex items-start justify-between gap-4">
              <div>
                <p className="font-mono text-[10px] font-bold uppercase tracking-[0.2em] text-[#ba8d6b]">A novel by Elena Voss</p>
                <h2 className="mt-2 max-w-[600px] font-serif text-[31px] leading-[1.02] tracking-[-0.025em] text-[#f1dfca] sm:text-[39px]">
                  A map is only useful<br className="hidden sm:block" /> if you know where to begin.
                </h2>
              </div>
              <button type="button" aria-label="More book options" onClick={() => setMenuOpen(!menuOpen)} className="rounded-lg p-2 text-[#9c8984] hover:bg-[#40353a] hover:text-[#e6c39c]">
                <MoreHorizontal size={18} />
              </button>
            </div>
            <p className="mt-5 max-w-[560px] text-[13px] leading-[1.75] text-[#aa9b96]">
              When Mira Voss finds a letter hidden inside her late father&apos;s atlas, she boards a night train for the coast he spent a lifetime refusing to name. What follows is part family mystery, part field guide to the places we carry home.
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#8f817e]">
              <span>12 chapters</span><span className="h-1 w-1 rounded-full bg-[#b57b5c]" /><span>4h 18m total</span><span className="h-1 w-1 rounded-full bg-[#b57b5c]" /><span>Literary mystery</span>
            </div>
            {menuOpen && (
              <div className="absolute right-0 top-10 z-10 w-40 rounded-xl border border-[#594348] bg-[#352b31] p-1.5 text-[11px] text-[#c9b4a8] shadow-xl">
                <button type="button" onClick={() => setMenuOpen(false)} className="flex w-full rounded-lg px-3 py-2 text-left hover:bg-[#46363c]">Add a bookmark</button>
                <button type="button" onClick={() => setMenuOpen(false)} className="flex w-full rounded-lg px-3 py-2 text-left hover:bg-[#46363c]">View book notes</button>
              </div>
            )}
          </div>

          <div className="rounded-2xl border border-[#4b3b3e] bg-[#32282d] p-5">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#a98d7d]"><Clock3 size={14} /> Your place</div>
            <div className="mt-5 flex items-end justify-between"><span className="font-serif text-[40px] leading-none text-[#e6b477]">46%</span><span className="pb-1 text-[10px] text-[#9e8b84]">read</span></div>
            <ProgressBar value={46} />
            <div className="mt-3 flex justify-between text-[10px] text-[#988780]"><span>Chapter 03</span><span>3h 12m left</span></div>
          </div>
        </section>

        <section className="grid gap-4 border-b border-[#44373a] py-7 md:grid-cols-3">
          <button type="button" onClick={() => setActiveAction("read")} className="group flex items-center gap-4 rounded-2xl border border-[#6b5046] bg-[#4b3536] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#d59b64]">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#dfaa6b] text-[#34251f]"><BookOpen size={18} /></span>
            <span className="min-w-0 flex-1"><span className="block text-[12px] font-bold text-[#f2ddc4]">Continue reading</span><span className="mt-1 block text-[10px] text-[#bba69b]">Chapter 03 · 21 min</span></span>
            <ArrowRight size={16} className="text-[#d5a26e] transition group-hover:translate-x-1" />
          </button>
          <button type="button" onClick={() => setActiveAction("listen")} className="group flex items-center gap-4 rounded-2xl border border-[#4b3b3f] bg-[#30272c] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#b88666]">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#76564f] text-[#f1d4b6]"><Headphones size={18} /></span>
             <span className="min-w-0 flex-1"><span className="block text-[12px] font-bold text-[#ebd8c8]">Listen to saved audio</span><span className="mt-1 block text-[10px] text-[#a89791]">Chapter 02 · Hindi · Ananya</span></span>
            <Play size={15} className="text-[#c99b70]" />
          </button>
          <button type="button" onClick={() => setActiveAction("create")} className="group flex items-center gap-4 rounded-2xl border border-[#4b3b3f] bg-[#30272c] p-4 text-left transition hover:-translate-y-0.5 hover:border-[#b88666]">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#5c5147] text-[#e8c9a3]"><WandSparkles size={18} /></span>
             <span className="min-w-0 flex-1"><span className="block text-[12px] font-bold text-[#ebd8c8]">Create audiobook</span><span className="mt-1 block text-[10px] text-[#a89791]">Retell, narrate, and save audio</span></span>
            <Sparkles size={15} className="text-[#c99b70]" />
          </button>
        </section>

        {actionLabel && <div className="border-b border-[#44373a] py-3 text-[11px] font-semibold text-[#d9af7c]"><Check size={14} className="mr-2 inline" />{actionLabel}</div>}

        <section className="flex flex-wrap items-center gap-2 border-b border-[#44373a] py-4">
          <span className="mr-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[#8e7d7b]">Book workspace</span>
          {(["READ", "LISTEN", "CREATE AUDIO"] as const).map((mode) => (
            <button
              type="button"
              key={mode}
              onClick={() => setActiveAction(mode === "READ" ? "read" : mode === "LISTEN" ? "listen" : "create")}
              className={`rounded-full px-3.5 py-2 text-[10px] font-bold tracking-[0.12em] transition ${((mode === "READ" && activeAction === "read") || (mode === "LISTEN" && activeAction === "listen") || (mode === "CREATE AUDIO" && activeAction === "create")) ? "bg-[#e4b06a] text-[#30231f]" : "border border-[#57464a] text-[#b8a39a] hover:border-[#b88666] hover:text-[#ecd8c4]"}`}
            >
              {mode}
            </button>
          ))}
          <span className="ml-auto hidden text-[10px] text-[#8f817d] sm:block">Reading is available before any audio is created.</span>
        </section>

        <section className="grid gap-8 py-8 xl:grid-cols-[1fr_360px]">
          <div>
            <div className="mb-5 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a68472]">The journey so far</p><h3 className="mt-1 font-serif text-[26px] text-[#ead7c2]">Three ways into the story</h3></div><span className="text-[10px] text-[#91817d]">Updated just now</span></div>
            <div className="grid gap-3 sm:grid-cols-3">
              <ProgressCard label="Reading" value={46} detail="84 of 192 pages" tone="gold" />
              <ProgressCard label="Listening" value={31} detail="1h 19m heard" tone="green" />
              <ProgressCard label="Audiobook" value={50} detail="6 of 12 chapters" tone="gold" />
            </div>
            <div className="mt-6 rounded-2xl border border-[#48383c] bg-[#30272c] p-5">
              <div className="flex items-center justify-between"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#a98b7a]"><Sparkles size={14} /> Audiobook generation</div><span className="text-[11px] font-semibold text-[#d9ac76]">50%</span></div>
              <div className="mt-4"><ProgressBar value={50} /></div>
              <p className="mt-3 text-[11px] leading-relaxed text-[#a79791]">Six chapters are ready in Hindi · Hinglish with Ananya&apos;s warm, close narration. Chapter 07 is being shaped now.</p>
              <button type="button" onClick={() => setActiveAction("create")} className="mt-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] text-[#d5a06b] hover:text-[#f0c17f]">Open studio <ChevronRight size={14} /></button>
            </div>
          </div>

          <div>
            <div className="mb-5 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a68472]">Recent activity</p><h3 className="mt-1 font-serif text-[26px] text-[#ead7c2]">Back to the page</h3></div><button type="button" className="text-[10px] font-bold uppercase tracking-[0.12em] text-[#b78c6d] hover:text-[#e5b778]">See all</button></div>
            <div className="divide-y divide-[#46373b] rounded-2xl border border-[#48383c] bg-[#30272c] px-4">
              {activities.map((item) => <div key={item.chapter} className="flex items-center gap-3 py-4"><span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full ${item.tone === "listen" ? "bg-[#49604f] text-[#b4d0b6]" : item.tone === "draft" ? "bg-[#5b4b42] text-[#e3ba8c]" : "bg-[#594044] text-[#dbad8a]"}`}>{item.tone === "listen" ? <Headphones size={14} /> : item.tone === "draft" ? <Sparkles size={14} /> : <Check size={14} />}</span><div className="min-w-0 flex-1"><div className="text-[11px] font-semibold text-[#dfcfc4]">{item.title}</div><div className="mt-1 truncate text-[10px] text-[#988883]">{item.chapter} · {item.detail}</div></div><span className="text-[9px] text-[#857674]">{item.time}</span></div>)}
            </div>
          </div>
        </section>
      </div>
    </AppLayout>
  );
}

function ProgressCard({ label, value, detail, tone }: { label: string; value: number; detail: string; tone: "gold" | "green" }) {
  return <div className="rounded-2xl border border-[#47383b] bg-[#30272c] p-4"><div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.14em] text-[#9c8984]"><span>{label}</span><span className={tone === "green" ? "text-[#9cba9f]" : "text-[#d4a16f]"}>{value}%</span></div><div className="mt-4"><ProgressBar value={value} tone={tone} /></div><p className="mt-3 text-[10px] text-[#948580]">{detail}</p></div>;
}