import { useState } from "react";
import {
  ChevronDown,
  ChevronUp,
  Clock3,
  ListMusic,
  Pause,
  Play,
  Repeat2,
  SkipBack,
  SkipForward,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { AppLayout, BookCover, ProgressBar } from "./_shared/AppLayout";
import { useProductState } from "./_shared/ProductState";

const chapters = [
  { no: "03", title: "The Letter in the Wall", duration: "21:04", progress: 38 },
  { no: "04", title: "What the River Keeps", duration: "27:18", progress: 0 },
  { no: "05", title: "Morning, Somewhere Else", duration: "19:42", progress: 0 },
];

export function MiniPlayer() {
  const [product, updateProduct] = useProductState();
  const [playing, setPlaying] = useState(true);
  const [language, setLanguage] = useState<"Original" | "Hindi · Hinglish">(product.language === "Original" ? "Original" : "Hindi · Hinglish");
  const [progress, setProgress] = useState(product.listeningProgress);
  const [queueOpen, setQueueOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [volume, setVolume] = useState(72);

  return (
    <AppLayout active="Library" compact>
      <div className="relative mx-auto max-w-[1060px] pb-8" style={{ fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif" }}>
        <div className="grid gap-5 lg:grid-cols-[1fr_315px]">
          <section className="rounded-[26px] border border-[#4d3d40] bg-[#30282d] p-6 shadow-[0_24px_60px_rgba(17,12,15,.2)] sm:p-8">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#d0a173]">
                <Volume2 size={14} /> Listening room
              </div>
              <span className="rounded-full border border-[#62504d] px-3 py-1 text-[9px] font-bold uppercase tracking-[0.16em] text-[#aa9790]">
                persistent player
              </span>
            </div>
            <div className="mt-9 flex items-start gap-5">
              <BookCover label={"THE\nCARTO-\nGRAPHER"} />
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-[0.17em] text-[#a5897c]">The Cartographer&apos;s Daughter</p>
                 <h1 className="mt-2 max-w-[480px] font-serif text-[38px] leading-[.98] tracking-[-0.035em] text-[#f2dfca] sm:text-[49px]">
                   {product.chapterTitle}
                 </h1>
                 <p className="mt-3 text-[12px] text-[#a99b96]">{product.author} <span className="mx-2 text-[#665457]">·</span> Chapter {product.selectedChapterNumber} of {product.totalChapters}</p>
              </div>
            </div>
            <div className="mt-9 rounded-2xl border border-[#4c3c40] bg-[#292328] p-5 sm:p-6">
              <div className="flex h-14 items-center gap-[4px] overflow-hidden">
                {Array.from({ length: 62 }).map((_, index) => (
                  <i key={index} className={`w-[3px] shrink-0 rounded-full ${index / 62 < progress / 100 ? "bg-[#d89c61]" : "bg-[#72565a]"}`} style={{ height: `${9 + ((index * 17) % 35)}px`, opacity: index / 62 < progress / 100 ? 1 : .64 }} />
                ))}
              </div>
              <div className="mt-3 flex items-center justify-between font-mono text-[10px] text-[#aa9992]"><span>08:17</span><span>21:04</span></div>
               <input aria-label="Narration progress" type="range" min="0" max="100" value={progress} onChange={(event) => { const next = Number(event.target.value); setProgress(next); updateProduct({ listeningProgress: next, activityLabel: `Listening at ${next}% in ${product.chapterTitle}` }); }} className="mt-1 h-1 w-full accent-[#e4b06a]" />
              <div className="mt-6 flex items-center justify-center gap-5">
                <button type="button" aria-label="Previous chapter" onClick={() => setProgress(0)} className="rounded-full p-2 text-[#a89690] hover:bg-[#42353a] hover:text-[#f0dfce]"><SkipBack size={17} /></button>
                <button type="button" aria-label={playing ? "Pause narration" : "Play narration"} onClick={() => setPlaying(!playing)} className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e4b06a] text-[#30221e] shadow-[0_7px_20px_rgba(228,176,106,.16)] transition hover:scale-105">{playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}</button>
                <button type="button" aria-label="Next chapter" onClick={() => setProgress(0)} className="rounded-full p-2 text-[#a89690] hover:bg-[#42353a] hover:text-[#f0dfce]"><SkipForward size={17} /></button>
              </div>
            </div>
          </section>

          <aside className="rounded-[26px] border border-[#d9c8b7] bg-[#eee3d6] p-5 text-[#55433d] shadow-[0_18px_45px_rgba(20,12,11,.13)]">
            <div className="flex items-center justify-between">
              <div><p className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#a18375]">Now playing</p><h2 className="mt-2 font-serif text-[26px] leading-none text-[#6d4e43]">A small choice</h2></div>
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#e0c6a9] text-[#895f4d]"><WandSparkles size={17} /></div>
            </div>
            <p className="mt-5 font-serif text-[17px] italic leading-relaxed text-[#765c51]">&ldquo;Some journeys begin long before the first step. They begin in the quiet decision not to turn around.&rdquo;</p>
            <div className="mt-6 border-t border-[#d6c2af] pt-5">
              <p className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#a18375]">Narration</p>
              <div className="mt-2 flex rounded-xl bg-[#e1d0bf] p-1">
                  {(["Original", "Hindi · Hinglish"] as const).map((item) => <button type="button" key={item} onClick={() => { setLanguage(item); updateProduct({ activityLabel: item === "Original" ? "Read aloud selected" : `Saved audio selected · ${product.selectedAudioVersionLabel}` }); }} className={`flex-1 rounded-lg px-2 py-2 text-[10px] font-bold transition ${language === item ? "bg-[#805746] text-[#f9eadc]" : "text-[#8e7569] hover:text-[#6d5145]"}`}>{item === "Original" ? "Read aloud" : "Audiobook"}</button>)}
              </div>
                <div className="mt-4 flex items-center justify-between gap-3 text-[11px]"><span className="min-w-0 truncate text-[#8a7065]">{language === "Original" ? "Temporary text-to-speech" : product.voice}</span><span className="shrink-0 rounded-full bg-[#d8ead9] px-2 py-1 text-[9px] font-bold text-[#5f7d65]">{language === "Original" ? "READ ALOUD" : "SAVED AUDIO"}</span></div>
            </div>
          </aside>
        </div>

        <section className="mt-5 rounded-[22px] border border-[#4a3a3e] bg-[#2d252a] p-4 sm:p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-[#a96049] font-serif text-[8px] leading-tight text-[#f7dfc4]">THE<br />LETTER</div>
               <div><p className="text-[11px] font-semibold text-[#e4d6ca]">Chapter {product.selectedChapterNumber} · {product.chapterTitle}</p><p className="mt-1 text-[10px] text-[#958782]">{language} <span className="mx-1.5 text-[#665457]">·</span> {playing ? "Playing now" : "Paused"} <span className="mx-1.5 text-[#665457]">·</span> 08:17 / 21:04</p></div>
            </div>
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => setSpeed(speed === 1 ? 1.25 : 1)} className="rounded-lg px-2.5 py-2 text-[10px] font-bold text-[#bca59b] hover:bg-[#40343a]">{speed}×</button>
              <button type="button" aria-label="Repeat" className="rounded-lg p-2 text-[#a99791] hover:bg-[#40343a]"><Repeat2 size={16} /></button>
              <button type="button" aria-label="Audio queue" onClick={() => setQueueOpen(!queueOpen)} className={`rounded-lg p-2 ${queueOpen ? "bg-[#4b393c] text-[#e4b06a]" : "text-[#a99791] hover:bg-[#40343a]"}`}><ListMusic size={17} /></button>
              <div className="ml-2 flex items-center gap-2 text-[#9c8c88]"><Volume2 size={15} /><input aria-label="Volume" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="w-16 accent-[#d89c61]" /></div>
            </div>
          </div>
          {queueOpen && <div className="mt-4 border-t border-[#46373b] pt-4"><div className="mb-2 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[#a98b78]"><Clock3 size={13} /> Up next</div><div className="grid gap-1 sm:grid-cols-3">{chapters.slice(1).map((item) => <button type="button" key={item.no} onClick={() => setQueueOpen(false)} className="flex items-center gap-2 rounded-lg px-2 py-2 text-left hover:bg-[#40343a]"><span className="font-mono text-[9px] text-[#b27e5e]">{item.no}</span><span className="min-w-0 flex-1 truncate text-[10px] text-[#c4b4ac]">{item.title}</span><span className="text-[9px] text-[#827476]">{item.duration}</span></button>)}</div></div>}
        </section>
         <div className="mt-5 flex items-center gap-3 px-2 text-[10px] text-[#8e807e]"><div className="min-w-0 flex-1"><ProgressBar value={product.readingProgress} /></div><span className="shrink-0">{product.readingProgress}% through the book</span><span className="hidden shrink-0 sm:inline">· 3h 12m left</span></div>
      </div>
    </AppLayout>
  );
}