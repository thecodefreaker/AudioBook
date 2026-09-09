import { useState } from "react";
import {
  Check,
  ChevronDown,
  CircleCheck,
  Clock3,
  Download,
  Headphones,
  LoaderCircle,
  Pause,
  Play,
  RotateCcw,
  Sparkles,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { AppLayout, BookCover, ProgressBar } from "./_shared/AppLayout";

type ChapterState = "ready" | "generating" | "not started";

const initialChapters: Array<{
  no: string;
  title: string;
  duration: string;
  state: ChapterState;
}> = [
  { no: "01", title: "The Night Train", duration: "18 min", state: "ready" },
  { no: "02", title: "A House of Blue Light", duration: "24 min", state: "ready" },
  { no: "03", title: "The Letter in the Wall", duration: "21 min", state: "ready" },
  { no: "04", title: "What the River Keeps", duration: "27 min", state: "generating" },
  { no: "05", title: "Morning, Somewhere Else", duration: "19 min", state: "not started" },
  { no: "06", title: "The Measure of Distance", duration: "23 min", state: "not started" },
];

function StateMark({ state }: { state: ChapterState }) {
  if (state === "ready") return <CircleCheck size={15} className="text-[#86a88e]" />;
  if (state === "generating") return <LoaderCircle size={15} className="animate-spin text-[#d89c61]" />;
  return <Clock3 size={14} className="text-[#887975]" />;
}

export function AudiobookOverview() {
  const [chapters, setChapters] = useState(initialChapters);
  const [selectedChapter, setSelectedChapter] = useState("04");
  const [playing, setPlaying] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [language, setLanguage] = useState("Hindi");
  const [voice, setVoice] = useState("Ananya · warm, close");
  const readyCount = 78;
  const overallProgress = 46;

  const continueGeneration = () => {
    setChapters((current) =>
      current.map((chapter) =>
        chapter.state === "generating" ? { ...chapter, state: "ready" } : chapter,
      ),
    );
  };

  return (
    <AppLayout
      active="Library"
      eyebrow="Your book · audiobook overview"
      title="A story, finding its voice."
      subtitle="Read the original whenever you like. Listen only to saved chapters, or continue creating the next one."
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.45fr)_minmax(300px,.7fr)]">
        <section className="overflow-hidden rounded-2xl border border-[#504047] bg-[#30282d] shadow-[0_18px_45px_rgba(25,17,20,.16)]">
          <div className="flex flex-col gap-6 p-5 sm:flex-row sm:p-7">
            <BookCover large label={"THE\nCARTOGRAPHER'S\nDAUGHTER"} />
            <div className="flex min-w-0 flex-1 flex-col justify-between">
              <div>
                <div className="mb-2 text-[9px] font-bold uppercase tracking-[.2em] text-[#bd946d]">
                  Elena Voss
                </div>
                <h2 className="max-w-[430px] font-serif text-[32px] leading-[.98] tracking-[-.03em] text-[#f1deca] sm:text-[40px]">
                  The Cartographer&apos;s Daughter
                </h2>
                <p className="mt-3 max-w-[460px] text-[12px] leading-relaxed text-[#a99a95]">
                  Part II · The Unmapped Coast
                  <span className="mx-2 text-[#69565a]">·</span>
                  2,545 chapters
                </p>
              </div>
              <div className="mt-7">
                <div className="mb-2 flex items-end justify-between">
                  <div>
                    <span className="font-serif text-[30px] text-[#efd0aa]">46%</span>
                    <span className="ml-2 text-[10px] uppercase tracking-[.14em] text-[#958681]">reading progress</span>
                  </div>
                  <span className="text-[10px] text-[#aa9892]">3h 12m left in this sitting</span>
                </div>
                <ProgressBar value={overallProgress} />
                <div className="mt-2 text-[10px] text-[#8f7c79]">
                  You last read <span className="text-[#d2b18f]">Chapter 03 · The Letter in the Wall</span>
                </div>
              </div>
            </div>
          </div>
          <div className="flex flex-col gap-3 border-t border-[#493b40] bg-[#2b2429] p-5 sm:flex-row sm:items-center sm:p-6">
            <button
              type="button"
              onClick={() => setPlaying(!playing)}
              className="flex items-center justify-center gap-2 rounded-xl bg-[#e4b06a] px-5 py-3 text-[11px] font-bold text-[#30231f] transition hover:-translate-y-0.5 hover:bg-[#f2c37c]"
            >
              {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
               {playing ? "Pause listening" : "Listen to saved audio"}
            </button>
            <button
              type="button"
              onClick={continueGeneration}
              className="flex items-center justify-center gap-2 rounded-xl border border-[#5b4848] px-5 py-3 text-[11px] font-bold text-[#e1c4a4] transition hover:border-[#b47d5b] hover:bg-[#3a2e32]"
            >
              <WandSparkles size={15} />
               Continue Create Audio
            </button>
            <button
              type="button"
              onClick={() => setDownloaded(true)}
              className="flex items-center justify-center gap-2 rounded-xl px-3 py-3 text-[11px] font-semibold text-[#ae9d98] hover:bg-[#3a3035] hover:text-[#ead9ca]"
            >
              {downloaded ? <Check size={15} className="text-[#86a88e]" /> : <Download size={15} />}
              {downloaded ? "Saved to device" : "Download ready"}
            </button>
          </div>
        </section>

        <aside className="rounded-2xl border border-[#4d3d42] bg-[#332a2f] p-5 sm:p-6">
          <div className="flex items-center gap-2 text-[9px] font-bold uppercase tracking-[.2em] text-[#bc956e]">
            <Headphones size={14} />
             Saved audiobook
          </div>
          <div className="mt-6 flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#4a3739] text-[#e4b06a]">
              <Volume2 size={18} />
            </div>
            <div>
              <div className="font-serif text-[23px] leading-none text-[#f0dcc7]">{language.split(" · ")[0]}</div>
               <div className="mt-1 text-[11px] text-[#a89691]">{language === "Hindi" ? "Devanagari" : language === "Hinglish" ? "Mixed script" : "Original voice"}</div>
            </div>
          </div>
          <div className="mt-7 space-y-4">
            <label className="block text-[9px] font-bold uppercase tracking-[.17em] text-[#98847f]">
              Language & texture
              <div className="relative mt-2">
               <select value={language} onChange={(event) => setLanguage(event.target.value)} className="w-full appearance-none rounded-xl border border-[#584449] bg-[#2c252a] px-3.5 py-3 text-[11px] text-[#e3d2c5] outline-none focus:border-[#c68a5d]">
                   <option>Hindi</option>
                   <option>Hinglish</option>
                   <option>English</option>
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-3.5 text-[#9f8b84]" />
              </div>
            </label>
            <label className="block text-[9px] font-bold uppercase tracking-[.17em] text-[#98847f]">
              Narrator voice
              <div className="relative mt-2">
                <select value={voice} onChange={(event) => setVoice(event.target.value)} className="w-full appearance-none rounded-xl border border-[#584449] bg-[#2c252a] px-3.5 py-3 text-[11px] text-[#e3d2c5] outline-none focus:border-[#c68a5d]">
                  <option>Ananya · warm, close</option>
                  <option>Kabir · low, unhurried</option>
                  <option>Meera · bright, intimate</option>
                </select>
                <ChevronDown size={14} className="pointer-events-none absolute right-3 top-3.5 text-[#9f8b84]" />
              </div>
            </label>
          </div>
          <div className="mt-6 flex items-center gap-2 border-t border-[#493a40] pt-4 text-[10px] text-[#95827d]">
            <Sparkles size={13} className="text-[#d89c61]" />
             Natural adaptation, not a line-by-line translation. Saved audio stays pinned to its script version.
          </div>
        </aside>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-[#b48e6c]">
               <Sparkles size={13} /> Saved audiobook chapters
            </div>
             <h2 className="mt-2 font-serif text-[30px] leading-none text-[#f0deca]">78 of 2,545 ready</h2>
          </div>
          <div className="text-right text-[10px] text-[#9a8884]">
             <div className="mb-2 text-[#d5b491]">3.1% voiced · reading stays at 46%</div>
            <div className="w-44"><ProgressBar value={3.1} tone="green" /></div>
          </div>
        </div>
        <div className="overflow-hidden rounded-2xl border border-[#4a3b40] bg-[#30272d]">
          {chapters.map((chapter, index) => (
            <button
              type="button"
              key={chapter.no}
              onClick={() => setSelectedChapter(chapter.no)}
              className={`flex w-full items-center gap-3 border-b border-[#45373c] px-4 py-3.5 text-left transition last:border-b-0 sm:px-5 ${selectedChapter === chapter.no ? "bg-[#42333a]" : "hover:bg-[#382d32]"}`}
            >
              <span className={`w-7 font-mono text-[10px] ${selectedChapter === chapter.no ? "text-[#d9a36c]" : "text-[#8d7b78]"}`}>{chapter.no}</span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate text-[12px] font-semibold ${selectedChapter === chapter.no ? "text-[#f0dbc4]" : "text-[#c9b8ae]"}`}>{chapter.title}</span>
                <span className="mt-0.5 block text-[10px] text-[#887874]">{index === 3 ? "Audio is being shaped now" : chapter.state === "ready" ? "Narration ready to play" : "Waiting in the queue"}</span>
              </span>
              <span className="hidden text-[10px] text-[#958480] sm:block">{chapter.duration}</span>
              <span className="flex items-center gap-2 text-[10px] font-semibold capitalize">
                <StateMark state={chapter.state} />
                <span className={chapter.state === "ready" ? "text-[#86a88e]" : chapter.state === "generating" ? "text-[#d89c61]" : "text-[#887975]"}>{chapter.state}</span>
              </span>
              {chapter.state === "generating" && <RotateCcw size={14} className="text-[#aa8880]" />}
            </button>
          ))}
          <div className="flex items-center justify-between border-t border-[#493a40] bg-[#2b2429] px-4 py-3 text-[10px] text-[#8f7d79] sm:px-5">
            <span>Showing the first 6 chapters of 2,545</span>
            <button type="button" onClick={() => setSelectedChapter("01")} className="font-bold uppercase tracking-[.14em] text-[#d2a06f] hover:text-[#efc184]">View all chapters</button>
          </div>
        </div>
      </section>
    </AppLayout>
  );
}