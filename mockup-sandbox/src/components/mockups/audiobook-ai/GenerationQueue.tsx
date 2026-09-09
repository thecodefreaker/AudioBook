import { useMemo, useState } from "react";
import {
  ArrowLeft,
  Check,
  Clock3,
  Cloud,
  Headphones,
  MoreHorizontal,
  Pause,
  Play,
  Radio,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Volume2,
} from "lucide-react";
import { AppLayout, BookCover, ProgressBar } from "./_shared/AppLayout";
import { useProductState } from "./_shared/ProductState";

type QueueStatus = "complete" | "active" | "waiting";

const initialChapters = [
  { number: "01", title: "The Night Train", duration: "18 min", status: "complete" as QueueStatus, detail: "Ready to listen" },
  { number: "02", title: "A House of Blue Light", duration: "24 min", status: "complete" as QueueStatus, detail: "Ready to listen" },
  { number: "03", title: "The Letter in the Wall", duration: "21 min", status: "active" as QueueStatus, detail: "Narrating · 08:42 remaining" },
  { number: "04", title: "What the River Keeps", duration: "27 min", status: "waiting" as QueueStatus, detail: "Waiting in queue" },
  { number: "05", title: "Morning, Somewhere Else", duration: "19 min", status: "waiting" as QueueStatus, detail: "Waiting in queue" },
];

export function GenerationQueue() {
  const [product, updateProduct] = useProductState();
  const [paused, setPaused] = useState(false);
  const [chapters, setChapters] = useState(initialChapters);
  const [notice, setNotice] = useState("");

  const doneCount = useMemo(() => chapters.filter((chapter) => chapter.status === "complete").length, [chapters]);
  const active = chapters.find((chapter) => chapter.status === "active");
  const complete = chapters.filter((chapter) => chapter.status === "complete");
  const waiting = chapters.filter((chapter) => chapter.status === "waiting");

  const toggleQueue = () => {
    setPaused((value) => !value);
    updateProduct({ generationStatus: paused ? "running" : "paused", activityLabel: paused ? "Generation resumed" : "Generation paused" });
    setNotice(paused ? "Generation resumed. You can leave this page open or return later." : "Generation paused. Your place in the queue is saved.");
  };

  const regenerate = (number: string) => {
    setChapters((items) => items.map((chapter) => chapter.number === number ? { ...chapter, status: "active", detail: "Preparing a fresh narration" } : chapter));
    setPaused(false);
    updateProduct({ selectedChapterNumber: number, generationStage: "Prepare", generationStageNumber: 1, generationProgress: 8, generationStatus: "running", activityLabel: `Preparing a fresh narration for Chapter ${number}` });
    setNotice("A fresh narration is being prepared for this chapter.");
  };

  return (
    <AppLayout
      active="Create Audio"
      eyebrow="Audio studio · generation queue"
      title="Making a listening room."
      subtitle="Your chapters are being shaped into a natural Hindi · Hinglish narration, one careful voice at a time."
    >
      <div className="max-w-[950px]">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <button type="button" onClick={() => setNotice("Returning to the studio settings is not available in this preview.")} className="flex items-center gap-2 text-[11px] font-semibold text-[#b89c8d] transition hover:text-[#e4b06a]">
            <ArrowLeft size={15} /> Back to studio
          </button>
          <div className="flex items-center gap-2 rounded-full border border-[#4a3a3e] bg-[#30282d] px-3 py-2 text-[10px] text-[#ae9c94]">
            <Radio size={13} className={paused ? "text-[#a89a91]" : "text-[#d89c61]"} />
            {paused ? "Queue paused" : "Generation in progress"}
          </div>
        </div>

        <section className="rounded-2xl border border-[#4c3c41] bg-[#31282d] p-5 shadow-[0_18px_50px_rgba(20,14,18,.18)] sm:p-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-center">
            <BookCover label={"THE\nCARTOGRAPHER'S\nDAUGHTER"} />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a88c7e]">The Cartographer&apos;s Daughter</div>
               <div className="mt-1 font-serif text-[27px] text-[#f0ddc9]">{product.language} audiobook</div>
               <div className="mt-2 text-[12px] text-[#a89891]">{product.voice} <span className="mx-2 text-[#645156]">·</span> {product.totalChapters} chapters <span className="mx-2 text-[#645156]">·</span> {product.generationJobId}</div>
              <div className="mt-5 flex items-center gap-3">
                <div className="max-w-[320px] flex-1"><ProgressBar value={Math.round((doneCount / 12) * 100 + 3)} /></div>
                <span className="font-mono text-[10px] text-[#d5b58e]">{doneCount} of 12 ready</span>
              </div>
            </div>
            <button type="button" onClick={toggleQueue} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#e4b06a] px-4 py-3 text-[11px] font-bold text-[#30231f] transition hover:bg-[#f0c27b]">
              {paused ? <Play size={14} fill="currentColor" /> : <Pause size={14} />}
              {paused ? "Resume queue" : "Pause queue"}
            </button>
          </div>
          {notice && <div className="mt-5 flex items-center gap-2 border-t border-[#493a3e] pt-4 text-[11px] text-[#d0b89e]"><Check size={14} className="text-[#9bb28f]" /> {notice}</div>}
        </section>

        <section className="mt-5 rounded-2xl border border-[#4c3c41] bg-[#2b2429] p-4 sm:p-5">
          <div className="mb-4 flex items-center justify-between gap-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a88f82]">Five-stage pipeline</div>
              <p className="mt-1 text-[11px] text-[#968681]">Every chapter is isolated, resumable, and traceable.</p>
            </div>
             <span className="max-w-full rounded-full border border-[#5b4c46] bg-[#3a302f] px-2.5 py-1 text-[9px] font-bold text-[#d6b184]">Chapter {product.selectedChapterNumber} · stage {product.generationStageNumber}/5</span>
          </div>
          <div className="grid gap-2 sm:grid-cols-5">
             {[
               ["01", "Prepare", product.generationStageNumber > 1 ? "done" : product.generationStage === "Prepare" ? "active" : "waiting"],
               ["02", "Retell", product.generationStageNumber > 2 ? "done" : product.generationStage === "Retell" ? "active" : "waiting"],
               ["03", "Narrate", product.generationStageNumber > 3 ? "done" : product.generationStage === "Narrate" ? "active" : "waiting"],
               ["04", "Stitch", product.generationStageNumber > 4 ? "done" : product.generationStage === "Stitch" ? "active" : "waiting"],
               ["05", "Index", product.generationStage === "Index" ? "active" : "waiting"],
            ].map(([number, label, state]) => (
              <div key={number} className={`rounded-xl border px-3 py-3 ${state === "active" ? "border-[#a26d51] bg-[#49363a]" : "border-[#493b3e] bg-[#32292e]"}`}>
                <div className={`font-mono text-[9px] ${state === "done" ? "text-[#8eb093]" : state === "active" ? "text-[#e3ad72]" : "text-[#817477]"}`}>{number}</div>
                <div className="mt-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#d3c0b4]">{label}</div>
                <div className="mt-1 text-[9px] text-[#8e807c]">{state === "done" ? "Complete" : state === "active" ? "In progress" : "Waiting"}</div>
              </div>
            ))}
          </div>
        </section>

        <div className="mt-7 grid gap-7 lg:grid-cols-[1fr_285px]">
          <section>
            <div className="mb-3 flex items-end justify-between">
              <div><div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#a88f82]">The queue</div><h2 className="mt-1 font-serif text-[28px] text-[#ead8c7]">Chapter by chapter</h2></div>
              <span className="text-[11px] text-[#968681]">{chapters.length - doneCount} remaining</span>
            </div>
            <div className="overflow-hidden rounded-2xl border border-[#493a3e] bg-[#2f272c]">
              {active && (
                <div className="border-b border-[#4e3d40] bg-[#382d32] p-4 sm:p-5">
                  <div className="flex items-start gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#bd815b]/20 text-[#e4b06a]"><Volume2 size={16} /></div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center justify-between gap-2"><div className="text-[11px] font-bold uppercase tracking-[0.15em] text-[#d9b38a]">Now generating</div><span className="font-mono text-[10px] text-[#b59d90]">41%</span></div>
                       <div className="mt-1 flex items-center justify-between gap-3"><h3 className="min-w-0 font-serif text-[21px] text-[#f0ddca]">Chapter {product.selectedChapterNumber} · {product.chapterTitle}</h3><span className="hidden shrink-0 text-[10px] text-[#a79890] sm:block">{paused ? "Paused" : product.generationStage}</span></div>
                       <div className="mt-3"><ProgressBar value={paused ? product.generationProgress : Math.max(product.generationProgress, 58)} /></div>
                      <div className="mt-2 flex items-center gap-2 text-[10px] text-[#a79790]"><Clock3 size={12} /> {paused ? "Ready to resume" : "About 08 minutes left"} <span className="text-[#615156]">·</span> Natural pauses being tuned</div>
                    </div>
                  </div>
                </div>
              )}
              {complete.map((chapter) => (
                <div key={chapter.number} className="flex items-center gap-3 border-b border-[#45363b] px-4 py-4 last:border-0 sm:px-5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#78947d]/15 text-[#91af94]"><Check size={15} /></div>
                  <div className="min-w-0 flex-1"><div className="text-[10px] uppercase tracking-[0.14em] text-[#8f817d]">Chapter {chapter.number}</div><div className="truncate font-serif text-[17px] text-[#ddcabb]">{chapter.title}</div></div>
                  <div className="hidden text-right sm:block"><div className="text-[10px] text-[#8e817d]">{chapter.detail}</div><div className="mt-1 font-mono text-[10px] text-[#b39d91]">{chapter.duration}</div></div>
                  <button type="button" aria-label={`Regenerate ${chapter.title}`} onClick={() => regenerate(chapter.number)} className="rounded-lg p-2 text-[#8f817d] hover:bg-[#46373b] hover:text-[#e4b06a]"><RotateCcw size={14} /></button>
                </div>
              ))}
              {waiting.map((chapter) => (
                <div key={chapter.number} className="flex items-center gap-3 border-b border-[#45363b] px-4 py-4 last:border-0 sm:px-5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-[#5a4849] text-[#9a8880]"><Clock3 size={14} /></div>
                  <div className="min-w-0 flex-1"><div className="text-[10px] uppercase tracking-[0.14em] text-[#827672]">Chapter {chapter.number}</div><div className="truncate font-serif text-[17px] text-[#b9aaa2]">{chapter.title}</div></div>
                  <div className="hidden text-right sm:block"><div className="text-[10px] text-[#817571]">Waiting in queue</div><div className="mt-1 font-mono text-[10px] text-[#93827c]">{chapter.duration}</div></div>
                  <MoreHorizontal size={16} className="text-[#71666a]" />
                </div>
              ))}
            </div>
          </section>

          <aside className="space-y-4">
             <div className="rounded-2xl border border-[#4a3a3e] bg-[#32292e] p-5">
               <div className="flex items-center justify-between">
                 <div className="flex items-center gap-2 text-[#d7b28d]"><Sparkles size={15} /><span className="text-[10px] font-bold uppercase tracking-[0.18em]">Quota health</span></div>
                 <span className="text-[10px] font-bold text-[#8fb294]">4 / 5 healthy</span>
               </div>
               <div className="mt-4 flex items-center justify-between text-[10px] text-[#9d8b86]"><span>Daily tokens</span><span className="font-mono text-[#d5b58e]">61k / 100k</span></div>
               <div className="mt-2 h-1.5 rounded-full bg-[#514047]"><div className="h-full w-[61%] rounded-full bg-[#d89c61]" /></div>
               <p className="mt-3 text-[10px] leading-relaxed text-[#8e807c]">One lane is cooling down. Other chapters continue on independent lanes instead of failing the whole job.</p>
             </div>
            <div className="rounded-2xl border border-[#4a3a3e] bg-[#32292e] p-5">
              <div className="flex items-center gap-2 text-[#d7b28d]"><Cloud size={16} /><span className="text-[10px] font-bold uppercase tracking-[0.18em]">You can leave this here</span></div>
              <p className="mt-3 text-[12px] leading-relaxed text-[#ad9c95]">Generation continues safely in the background. Close this window, return to reading, or come back later — your place is saved.</p>
              <div className="mt-4 flex items-center gap-2 border-t border-[#493a3d] pt-4 text-[10px] text-[#958580]"><ShieldCheck size={14} className="text-[#8ca589]" /> Your source text stays private</div>
            </div>
            <div className="rounded-2xl border border-[#4a3a3e] bg-[#2d252a] p-5">
              <div className="flex items-center gap-2 text-[#bd9c7c]"><Sparkles size={15} /><span className="text-[10px] font-bold uppercase tracking-[0.18em]">A little context</span></div>
              <p className="mt-3 font-serif text-[16px] leading-relaxed text-[#cbb8aa]">We are keeping the silences, the breath between thoughts, and the shape of Elena Voss&apos;s sentences.</p>
               <div className="mt-4 text-[10px] text-[#887b78]">Voice profile · {product.voice} · saved for this job</div>
            </div>
          </aside>
        </div>
      </div>
    </AppLayout>
  );
}