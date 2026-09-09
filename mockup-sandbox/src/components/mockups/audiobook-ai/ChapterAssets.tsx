import { useState } from "react";
import { AlertTriangle, Archive, Check, ChevronRight, Clock3, FileText, Headphones, Play, Sparkles } from "lucide-react";
import { AppLayout, ProgressBar } from "./_shared/AppLayout";
import { useProductState } from "./_shared/ProductState";

type Chapter = { id: number; title: string; original: string; ai: number; custom: number; audio: number; state: "ready" | "running" | "queued" | "failed"; };
const chapters: Chapter[] = [
  { id: 1, title: "The Night Train", original: "18,420 words", ai: 3, custom: 1, audio: 2, state: "ready" },
  { id: 2, title: "A House of Blue Light", original: "21,108 words", ai: 2, custom: 0, audio: 1, state: "ready" },
  { id: 3, title: "The Letter in the Wall", original: "19,864 words", ai: 4, custom: 2, audio: 0, state: "ready" },
  { id: 4, title: "What the River Keeps", original: "16,901 words", ai: 1, custom: 1, audio: 0, state: "running" },
  { id: 5, title: "The Coast Road", original: "22,410 words", ai: 0, custom: 0, audio: 0, state: "queued" },
  { id: 6, title: "A Compass in Winter", original: "17,204 words", ai: 2, custom: 0, audio: 0, state: "failed" },
];
const tone: Record<Chapter["state"], string> = { ready: "border-[#526c58] bg-[#34443b] text-[#a9c5a7]", running: "border-[#765d42] bg-[#4a3930] text-[#e4b579]", queued: "border-[#51444a] bg-[#373037] text-[#b8a8a7]", failed: "border-[#754947] bg-[#493238] text-[#e1a097]" };

export function ChapterAssets() {
  const [product, updateProduct] = useProductState();
  const [selected, setSelected] = useState(Number(product.selectedChapterNumber));
  const [notice, setNotice] = useState("");
  const chapter = chapters.find((item) => item.id === selected) ?? chapters[2];
  const action = (text: string) => { setNotice(text); window.setTimeout(() => setNotice(""), 2600); };
  return (
     <AppLayout active="Library" eyebrow="Content history · chapter assets" title="Chapter assets" subtitle="A durable map of every source text, script revision, and narrated output in My Vampire System.">
      {notice && <div className="mb-5 rounded-xl border border-[#8a6948] bg-[#49382f] px-4 py-3 text-[11px] text-[#edc48e]"><Check size={14} className="mr-2 inline" />{notice}</div>}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.35fr)_340px]">
        <section className="overflow-hidden rounded-2xl border border-[#493b40] bg-[#30272d]">
          <div className="flex flex-wrap items-end justify-between gap-4 border-b border-[#493b40] px-5 py-5">
             <div><div className="text-[10px] font-bold uppercase tracking-[.2em] text-[#bd916e]">Book / 12 chapters</div><h2 className="mt-2 font-serif text-[27px] text-[#ead8c6]">My Vampire System</h2></div>
            <div className="text-right text-[10px] text-[#968783]"><span className="font-mono text-[#d7aa75]">6</span> chapters with saved assets<br /><span className="text-[#91b397]">9 audio versions recoverable</span></div>
          </div>
          <div className="divide-y divide-[#44363b]">
             {chapters.map((item) => <button key={item.id} type="button" onClick={() => { setSelected(item.id); updateProduct({ selectedChapterNumber: String(item.id).padStart(2, "0"), selectedChapterId: `chapter-${String(item.id).padStart(2, "0")}`, chapterTitle: item.title, activityLabel: `Chapter ${String(item.id).padStart(2, "0")} assets selected` }); }} className={`flex w-full items-center gap-3 px-5 py-4 text-left transition hover:bg-[#382d33] ${selected === item.id ? "bg-[#3f3036] shadow-[inset_3px_0_0_#d89c61]" : ""}`}>
              <span className="w-7 font-mono text-[10px] text-[#887878]">0{item.id}</span><span className="min-w-0 flex-1"><span className="block truncate font-serif text-[17px] text-[#e4d3c7]">{item.title}</span><span className="mt-1 block text-[9px] text-[#918181]">{item.original} · immutable original</span></span>
              <span className="hidden items-center gap-1.5 text-[9px] text-[#a4938f] md:flex"><FileText size={12} className="text-[#bf9d7a]" />{item.ai} AI <span className="text-[#635258]">·</span> {item.custom} custom</span>
              <span className="hidden items-center gap-1.5 text-[9px] text-[#a4938f] sm:flex"><Headphones size={12} className="text-[#86a88e]" />{item.audio} audio</span>
              <span className={`rounded-full border px-2 py-1 text-[8px] font-bold uppercase tracking-[.12em] ${tone[item.state]}`}>{item.state}</span><ChevronRight size={14} className="text-[#75666b]" />
            </button>)}
          </div>
        </section>
        <aside className="rounded-2xl border border-[#d5c2ae] bg-[#eee2d5] p-5 text-[#533f39] shadow-[0_18px_45px_rgba(18,12,15,.12)]">
          <div className="flex items-center justify-between"><div className="text-[10px] font-bold uppercase tracking-[.18em] text-[#9d7561]">Selected chapter</div><span className="rounded-full bg-[#dfe8dc] px-2 py-1 text-[8px] font-bold uppercase tracking-[.12em] text-[#607962]">source intact</span></div>
          <h2 className="mt-3 font-serif text-[29px] leading-tight">{chapter.title}</h2><p className="mt-2 text-[11px] text-[#8c756d]">Chapter 0{chapter.id} · original text is immutable</p>
          <div className="mt-6 grid grid-cols-2 gap-2">{[["Original", "1", "system source"], ["AI scripts", String(chapter.ai), "saved revisions"], ["Custom scripts", String(chapter.custom), "your edits"], ["Audio", String(chapter.audio), "recoverable"]].map(([label, value, detail]) => <div key={label} className="rounded-xl border border-[#d9c7b8] bg-[#f5eadf] p-3"><div className="text-[9px] uppercase tracking-[.13em] text-[#987d70]">{label}</div><div className="mt-2 font-serif text-[24px] text-[#654b41]">{value}</div><div className="text-[9px] text-[#a0877b]">{detail}</div></div>)}</div>
           <div className="mt-5 rounded-xl border border-[#a78a67] bg-[#e8d9c9] p-4"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.13em] text-[#866047]"><Sparkles size={14} /> Meaningful state</div><div className="mt-2 font-serif text-[19px] text-[#60473d]">AI Script V4 ready · no audio</div><p className="mt-2 text-[10px] leading-relaxed text-[#896f64]">The reviewed retelling of the vampire system awakening is saved. Generating audio later will use this exact revision and will not run AI again.</p><button type="button" onClick={() => action("Opening AI Script V4 in the revision history")} className="mt-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.12em] text-[#9a664b]">Open script history <ChevronRight size={13} /></button></div>
          <div className="mt-5 flex items-center justify-between text-[9px] uppercase tracking-[.12em] text-[#9d8378]"><span>Asset readiness</span><span className="text-[#6d896e]">75%</span></div><div className="mt-2"><ProgressBar value={75} tone="green" /></div>
          <div className="mt-5 flex flex-wrap gap-2"><button type="button" onClick={() => action("Reader will open AI Script V4")} className="flex items-center gap-2 rounded-lg bg-[#765044] px-3 py-2 text-[10px] font-bold text-[#faead7]"><Play size={13} /> Read selected revision</button><button type="button" onClick={() => action("No deletion performed · dependencies remain visible")} className="rounded-lg border border-[#c7ae9d] px-3 py-2 text-[10px] font-bold text-[#896554]"><Archive size={13} className="mr-1 inline" /> Manage assets</button></div>
        </aside>
      </div>
      <div className="mt-5 flex items-center gap-2 text-[10px] text-[#88797c]"><Clock3 size={13} /> Counts describe durable assets, not temporary jobs. <AlertTriangle size={13} className="ml-2 text-[#c88770]" /> Failed jobs never remove completed scripts.</div>
    </AppLayout>
  );
}