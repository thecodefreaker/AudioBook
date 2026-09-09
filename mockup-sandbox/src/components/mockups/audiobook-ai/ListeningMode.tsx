import { useState } from "react";
import {
  ArrowLeft,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Headphones,
  ListMusic,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SlidersHorizontal,
  Sparkles,
  Text,
  Volume2,
} from "lucide-react";
import { AppLayout, BookCover, ProgressBar } from "./_shared/AppLayout";
import { percentLabel, useProductState } from "./_shared/ProductState";

const bars = [18, 28, 42, 31, 52, 66, 44, 72, 58, 35, 48, 78, 62, 38, 25, 44, 68, 55, 82, 60, 40, 56, 76, 48, 30, 44, 61, 72, 51, 34, 47, 68, 79, 57, 39, 28, 46, 63, 52, 36, 22, 41, 58, 74, 50, 32, 45, 64, 72, 53, 34, 24, 39, 57, 69, 47, 31, 44, 60, 76, 54, 37, 29, 43, 55, 68, 48, 33, 44, 62, 73, 51, 35, 27, 41, 56, 67, 46, 30, 22, 38, 52];

function Waveform({ progress }: { progress: number }) {
  return (
    <div className="relative h-[74px] overflow-hidden">
      <div className="absolute inset-x-0 top-1/2 h-px bg-[#5c4a4c]" />
      <div className="relative flex h-full items-center gap-[3px]">
        {bars.map((height, index) => {
          const filled = (index / bars.length) * 100 < progress;
          return (
            <span
              key={index}
              className={`w-[3px] shrink-0 rounded-full transition-opacity ${filled ? "bg-[#e0aa69]" : "bg-[#70565a]"}`}
              style={{ height: `${height}%` }}
            />
          );
        })}
      </div>
    </div>
  );
}

export function ListeningMode() {
  const [product, updateProduct] = useProductState();
  const [playing, setPlaying] = useState(true);
  const [progress, setProgress] = useState(product.listeningProgress);
  const [speed, setSpeed] = useState(1);
  const [transcript, setTranscript] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <AppLayout active="Library" compact>
      <div className="relative mx-auto max-w-[1030px]">
        <div className="mb-7 flex items-center justify-between">
          <button type="button" className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#9b8985] transition hover:text-[#e4b06a]">
            <ArrowLeft size={14} /> Back to library
          </button>
          <div className="flex items-center gap-2">
            <button
              type="button"
              aria-label="Save bookmark"
              onClick={() => setSaved(!saved)}
              className={`rounded-lg p-2 transition ${saved ? "bg-[#4a3739] text-[#e4b06a]" : "text-[#a6938d] hover:bg-[#3b3034] hover:text-[#e4b06a]"}`}
            >
              <Bookmark size={16} fill={saved ? "currentColor" : "none"} />
            </button>
            <button type="button" aria-label="Open queue" className="rounded-lg p-2 text-[#a6938d] transition hover:bg-[#3b3034] hover:text-[#e4b06a]">
              <ListMusic size={17} />
            </button>
          </div>
        </div>

        <div className="grid gap-10 lg:grid-cols-[280px_minmax(0,1fr)] lg:gap-14">
          <section className="flex flex-col items-center lg:items-start">
            <div className="relative">
              <BookCover label={"MY\nVAMPIRE\nSYSTEM"} large />
              <div className="absolute -bottom-3 -right-3 rounded-full border border-[#674b45] bg-[#3b2e33] px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.14em] text-[#d8b083]">
                 Saved audiobook
              </div>
            </div>
            <div className="mt-8 text-center lg:text-left">
              <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#a98168]">Listening mode</div>
               <p className="mt-2 font-serif text-[19px] italic text-[#d9c4b5]">{product.bookTitle}</p>
               <p className="mt-1 text-[11px] text-[#96847f]">{product.author}</p>
            </div>
            <div className="mt-7 hidden w-full border-t border-[#483a3e] pt-5 lg:block">
              <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.18em] text-[#8c7976]">
                <span>Book progress</span>
                 <span className="text-[#d4a56f]">{percentLabel(product.readingProgress)}</span>
              </div>
               <div className="mt-3"><ProgressBar value={product.readingProgress} /></div>
               <div className="mt-2 flex justify-between text-[10px] text-[#817272]"><span>Chapter {product.selectedChapterNumber} of {product.totalChapters}</span><span>3h 12m left</span></div>
            </div>
          </section>

          <section className="min-w-0 pt-1">
            <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-[0.2em] text-[#b58d6e]">
               <span>Chapter {product.selectedChapterNumber}</span><span className="h-1 w-1 rounded-full bg-[#bf835e]" /><span>{product.chapterDuration}</span>
            </div>
            <h1 className="mt-4 max-w-[650px] font-serif text-[54px] leading-[0.94] tracking-[-0.045em] text-[#f1dfcc] sm:text-[72px]">
              {product.chapterTitle}
            </h1>
            <p className="mt-5 max-w-[520px] text-[13px] leading-relaxed text-[#a89792]">
                A saved {product.language} audiobook chapter, shaped from {product.author}&apos;s original text. Unhurried, close, and made for the hour after dark.
            </p>

            <div className="mt-9 rounded-[22px] border border-[#544348] bg-[#30272d] px-5 pb-5 pt-5 shadow-[0_20px_45px_rgba(19,14,17,.18)] sm:px-7">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.17em] text-[#a58d87]">
                    <Headphones size={14} className="text-[#d8a267]" /> {product.voice} · saved audio
                </div>
                 <span className="rounded-full bg-[#46353a] px-2.5 py-1 text-[9px] font-bold text-[#c4aba0]">{product.language}</span>
              </div>
              <div className="mt-5"><Waveform progress={progress} /></div>
              <div className="mt-1 flex items-center justify-between font-mono text-[10px] text-[#a18d89]">
                <span>{playing ? "09:26" : "09:12"}</span><span>24:08</span>
              </div>
              <input
                aria-label="Listening progress"
                type="range"
                min="0"
                max="100"
                value={progress}
                 onChange={(event) => { const next = Number(event.target.value); setProgress(next); updateProduct({ listeningProgress: next, activityLabel: `Listening at ${next}% in ${product.chapterTitle}` }); }}
                className="mt-2 h-1 w-full cursor-pointer accent-[#e4b06a]"
              />
              <div className="mt-6 flex items-center justify-center gap-7 text-[#b79f97]">
                <button type="button" aria-label="Previous fifteen seconds" className="transition hover:text-[#f1dfcc]"><RotateCcw size={18} /><span className="sr-only">15 seconds</span></button>
                <button type="button" aria-label={playing ? "Pause" : "Play"} onClick={() => setPlaying(!playing)} className="flex h-14 w-14 items-center justify-center rounded-full bg-[#e4b06a] text-[#2b2020] shadow-[0_8px_22px_rgba(228,176,106,.16)] transition hover:scale-105 hover:bg-[#f1c27b]">
                  {playing ? <Pause size={21} fill="currentColor" /> : <Play size={21} fill="currentColor" />}
                </button>
                <button type="button" aria-label="Next fifteen seconds" className="transition hover:text-[#f1dfcc]"><RotateCw size={18} /><span className="sr-only">15 seconds</span></button>
              </div>
              <div className="mt-6 flex items-center justify-between border-t border-[#493a3f] pt-4">
                <button type="button" onClick={() => setTranscript(!transcript)} className={`flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.15em] transition ${transcript ? "text-[#e4b06a]" : "text-[#9e8b86] hover:text-[#ead8c8]"}`}>
                  <Text size={14} /> {transcript ? "Hide transcript" : "Show transcript"}
                </button>
                <div className="flex items-center gap-3 text-[#a28e88]">
                  <SlidersHorizontal size={14} />
                  <button type="button" onClick={() => setSpeed(speed === 1.25 ? 1 : speed + 0.25)} className="min-w-[35px] rounded-md border border-[#5a4649] px-2 py-1 text-[10px] font-bold text-[#d5b5a0] hover:border-[#b98059]">{speed}×</button>
                  <Volume2 size={15} />
                </div>
              </div>
              {transcript && <p className="mt-5 border-t border-[#493a3f] pt-4 font-serif text-[16px] leading-relaxed text-[#d4c1b5]">“Raat ke is hisse mein, sheher apni saans dheemi kar leta tha. Mira ne khidki se bahar dekha, aur neeli roshni mein ghar bilkul kisi purane naqshay jaise lag rahe the.”</p>}
            </div>

            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              <button type="button" className="group flex items-center gap-4 rounded-xl border border-[#493a3e] bg-[#2d252a] p-3.5 text-left transition hover:border-[#745249]">
                <ChevronLeft size={18} className="text-[#b68768] transition group-hover:-translate-x-1" />
                <span><span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-[#887572]">Previous chapter</span><span className="mt-1 block font-serif text-[16px] text-[#d5c0b2]">The Night Train</span></span>
              </button>
              <button type="button" className="group flex items-center justify-end gap-4 rounded-xl border border-[#493a3e] bg-[#2d252a] p-3.5 text-right transition hover:border-[#745249]">
                <span><span className="block text-[9px] font-bold uppercase tracking-[0.18em] text-[#887572]">Up next</span><span className="mt-1 block font-serif text-[16px] text-[#d5c0b2]">The Letter in the Wall</span></span>
                <ChevronRight size={18} className="text-[#b68768] transition group-hover:translate-x-1" />
              </button>
            </div>
            <div className="mt-8 flex items-center gap-2 text-[10px] text-[#837371]"><Sparkles size={13} className="text-[#bd895d]" /> Your place is saved automatically when you leave.</div>
          </section>
        </div>
      </div>
    </AppLayout>
  );
}