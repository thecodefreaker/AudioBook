import { useState, type ReactNode } from "react";
import {
  ArrowRight,
  BookOpen,
  Check,
  Headphones,
  MoreHorizontal,
  Play,
  Sparkles,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { AppLayout, BookCover, ProgressBar } from "./_shared/AppLayout";
import { percentLabel, useProductState } from "./_shared/ProductState";

const recentBooks = [
  { title: "The Cartographer's Daughter", author: "Elena Voss", progress: "46%", note: "Chapter 03 · 2 days ago", active: true },
  { title: "A Field Guide to Quiet", author: "Nila Sen", progress: "18%", note: "Chapter 01 · added yesterday", active: false },
  { title: "The Sea Between Rooms", author: "Tomas Vale", progress: "New", note: "Ready to begin", active: false },
];

function ActionButton({ children, onClick, secondary = false }: { children: ReactNode; onClick: () => void; secondary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-[11px] font-bold transition hover:-translate-y-0.5 ${
        secondary
          ? "border border-[#66504a] text-[#e0c9b8] hover:border-[#c58a61] hover:bg-[#3b3034]"
          : "bg-[#e4b06a] text-[#30231f] shadow-[0_8px_22px_rgba(215,155,92,.12)] hover:bg-[#f0c27b]"
      }`}
    >
      {children}
    </button>
  );
}

export function Home() {
  const [notice, setNotice] = useState("");
  const [product, updateProduct] = useProductState();
  const notify = (message: string) => {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 2400);
  };

  return (
    <AppLayout active="Home" eyebrow="Good evening, Riya" title="Your reading room" subtitle="A little space for the stories you are in the middle of. Pick up where you left off, or give a chapter a new voice.">
      <div className="grid gap-5 xl:grid-cols-[1.36fr_.84fr]">
        <section className="relative overflow-hidden rounded-2xl border border-[#594148] bg-[#352b31] p-5 sm:p-7">
          <div className="absolute -right-12 -top-20 h-52 w-52 rounded-full bg-[#8a5d4b]/10 blur-3xl" />
          <div className="relative flex items-start justify-between gap-4">
            <div>
            <div className="mb-3 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.2em] text-[#c9976b]"><BookOpen size={14} /> Continue reading</div>
              <h2 className="max-w-[420px] font-serif text-[31px] leading-[1.02] text-[#f2dfca] sm:text-[38px]">{product.chapterTitle}</h2>
              <p className="mt-2 text-[12px] text-[#a99791]">{product.bookTitle} <span className="mx-1.5 text-[#6f5c5b]">·</span> {product.author}</p>
            </div>
            <button type="button" onClick={() => notify("Book options are ready")} aria-label="Book options" className="rounded-lg p-1 text-[#9f8985] hover:bg-[#46373d] hover:text-[#f2dfca]"><MoreHorizontal size={18} /></button>
          </div>
          <div className="relative mt-7 flex items-end gap-5">
             <BookCover label={"MY\nVAMPIRE\nSYSTEM"} />
            <div className="min-w-0 flex-1 pb-1">
               <div className="flex items-center justify-between gap-3 text-[10px] text-[#a7958f]"><span>Chapter {product.selectedChapterNumber} of {product.totalChapters}</span><span className="shrink-0 font-mono text-[#d1a574]">{percentLabel(product.readingProgress)}</span></div>
               <div className="mt-2"><ProgressBar value={product.readingProgress} /></div>
              <p className="mt-3 max-w-[250px] text-[11px] leading-relaxed text-[#9e8a85]">Mira finds the first map hidden behind the plaster, and a reason to keep travelling.</p>
                <ActionButton onClick={() => { updateProduct({ activityLabel: `Reading ${product.chapterTitle}` }); notify(`Opening Chapter ${product.selectedChapterNumber}`); }}> <BookOpen size={14} /> Read chapter</ActionButton>
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-[#514247] bg-[#30272d] p-5 sm:p-7">
           <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.2em] text-[#b88d72]"><Headphones size={14} /> Continue listening</div>
          <div className="mt-5 flex items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-full border border-[#745249] bg-[#49343a] text-[#e4b06a]"><Play size={21} fill="currentColor" /></div>
             <div className="min-w-0"><h2 className="truncate font-serif text-[25px] text-[#f0ddcb]">{product.chapterTitle}</h2><p className="mt-1 text-[11px] text-[#9f8d88]">Chapter {product.selectedChapterNumber} · {product.selectedAudioVersionLabel}</p></div>
          </div>
           <div className="mt-6 flex items-center gap-3 text-[10px] text-[#9f8a83]"><span>{Math.round(product.listeningProgress * 0.21)}:04</span><div className="flex-1"><ProgressBar value={product.listeningProgress} tone="green" /></div><span>21:04</span></div>
            <div className="mt-5 flex items-center justify-between gap-3"><span className="flex min-w-0 items-center gap-2 text-[10px] text-[#9f8d88]"><Volume2 size={14} /> <span className="truncate">Saved audiobook · {product.voice}</span></span><button type="button" onClick={() => { updateProduct({ activityLabel: `Listening to ${product.chapterTitle}` }); notify("Listening queue opened"); }} className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-[#d8aa75] hover:text-[#f0c27b]">Queue <ArrowRight size={13} className="ml-1 inline" /></button></div>
        </section>
      </div>

      <section className="mt-5 rounded-2xl border border-[#514047] bg-[#31272d] p-5 sm:p-7">
        <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div><div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.2em] text-[#c49b72]"><Sparkles size={14} /> Create audio</div><h2 className="mt-2 font-serif text-[27px] text-[#f0dfcd]">{product.language} retelling in progress</h2><p className="mt-1 text-[11px] text-[#9e8b86]">Chapter {product.selectedChapterNumber} · {product.chapterTitle} · {product.generationStage} stage</p></div>
           <span className="shrink-0 rounded-full border border-[#5b5143] bg-[#40382f] px-3 py-1.5 text-[9px] font-bold uppercase tracking-wider text-[#d9b17e]">Stage {product.generationStageNumber} of 5 · {product.generationProgress}%</span>
        </div>
          <div className="mt-6 grid gap-5 md:grid-cols-[1fr_200px] md:items-end"><div><ProgressBar value={product.generationProgress} tone="green" /><div className="mt-2 flex flex-wrap justify-between gap-2 text-[10px] text-[#998681]"><span>Prepare ✓ · Retell ✓ · Narrate → · Stitch · Index</span><span>About 4 min left</span></div></div><button type="button" onClick={() => { updateProduct({ activityLabel: "Returned to audiobook creation" }); notify("Create Audio opened"); }} className="inline-flex items-center justify-center gap-2 rounded-xl border border-[#66504a] px-4 py-3 text-[11px] font-bold text-[#e0c9b8] hover:border-[#c58a61]"><WandSparkles size={14} /> Continue creating</button></div>
      </section>

      <section className="mt-9">
        <div className="mb-4 flex items-end justify-between"><div><div className="text-[9px] font-bold uppercase tracking-[.2em] text-[#9c8581]">Your shelf</div><h2 className="mt-2 font-serif text-[29px] text-[#eddbca]">Recently added</h2></div><button type="button" onClick={() => notify("Library opened")} className="text-[10px] font-bold uppercase tracking-[.16em] text-[#d5a06d] hover:text-[#f0c27b]">See library <ArrowRight size={13} className="ml-1 inline" /></button></div>
        <div className="grid gap-3 md:grid-cols-3">{recentBooks.map((book, index) => <button type="button" key={book.title} onClick={() => notify(`Opening ${book.title}`)} className={`group flex items-center gap-4 rounded-2xl border p-4 text-left transition hover:-translate-y-0.5 hover:border-[#8e6251] ${book.active ? "border-[#67484a] bg-[#382d32]" : "border-[#463a3e] bg-[#2f282d]"}`}><BookCover label={index === 0 ? "THE\nCARTOGRAPHER" : index === 1 ? "A FIELD\nGUIDE" : "THE SEA\nBETWEEN"} /><span className="min-w-0 flex-1"><strong className="block font-serif text-[18px] leading-tight text-[#ead8c7] group-hover:text-[#f3c582]">{book.title}</strong><span className="mt-1 block text-[10px] text-[#9d8a85]">{book.author}</span><span className="mt-4 block text-[10px] text-[#b49b91]">{book.note}</span>{book.active ? <span className="mt-2 block"><ProgressBar value={46} /></span> : <span className="mt-2 block text-[10px] text-[#c29a76]">{book.progress}</span>}</span>{book.active && <Check size={14} className="self-start text-[#7ea286]" />}</button>)}</div>
      </section>
      {notice && <div className="fixed bottom-5 right-5 z-50 rounded-xl border border-[#76554c] bg-[#3c2d32] px-4 py-3 text-[11px] text-[#f0dfcd] shadow-2xl">{notice}</div>}
    </AppLayout>
  );
}