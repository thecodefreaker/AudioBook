import { useMemo, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Headphones,
  Info,
  Languages,
  Mic2,
  Minus,
  Plus,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { AppLayout, BookCover, ProgressBar } from "./_shared/AppLayout";
import { useProductState } from "./_shared/ProductState";

const chapterList = [
  { number: "01", title: "The Night Train", duration: "18 min" },
  { number: "02", title: "A House of Blue Light", duration: "24 min" },
  { number: "03", title: "The Letter in the Wall", duration: "21 min" },
  { number: "04", title: "What the River Keeps", duration: "27 min" },
  { number: "05", title: "Morning, Somewhere Else", duration: "19 min" },
];

function SelectField({
  label,
  icon: Icon,
  value,
  options,
  onChange,
}: {
  label: string;
  icon: typeof Languages;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#a9958b]">
        <Icon size={13} className="text-[#c79061]" />
        {label}
      </span>
      <span className="relative mt-2 block">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="w-full appearance-none rounded-xl border border-[#514147] bg-[#352d32] px-3.5 py-3 text-[12px] text-[#ead9cc] outline-none transition focus:border-[#c4875d]"
        >
          {options.map((option) => (
            <option key={option}>{option}</option>
          ))}
        </select>
        <ChevronDown size={15} className="pointer-events-none absolute right-3 top-3.5 text-[#9f8b82]" />
      </span>
    </label>
  );
}

export function CreateAudiobook() {
  const [product, updateProduct] = useProductState();
  const [selected, setSelected] = useState<number[]>([0, 1, 2]);
  const [language, setLanguage] = useState(product.language);
  const [style, setStyle] = useState("Natural retelling");
  const [voice, setVoice] = useState(product.voice);
  const [pace, setPace] = useState("Unhurried");
  const [rate, setRate] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [volume, setVolume] = useState(82);
  const [includeOriginal, setIncludeOriginal] = useState(true);
  const [chapterNotes, setChapterNotes] = useState(false);
  const [generated, setGenerated] = useState(product.generationStatus !== "queued");

  const totalMinutes = useMemo(
    () => selected.reduce((total, index) => total + Number(chapterList[index].duration.split(" ")[0]), 0),
    [selected],
  );

  const toggleChapter = (index: number) => {
    setSelected((current) =>
      current.includes(index) ? current.filter((item) => item !== index) : [...current, index].sort(),
    );
  };

  return (
    <AppLayout
       active="Create Audio"
      eyebrow="Audiobook studio"
       title="Create a saved audiobook."
       subtitle="Choose chapters, shape the retelling, then narrate it into audio you can return to. Reading aloud stays separate and instant."
    >
      <div className="grid gap-5 pb-8 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,.85fr)]">
        <section className="rounded-2xl border border-[#4b3b40] bg-[#30272d] p-5 shadow-[0_22px_50px_rgba(16,12,15,.13)] sm:p-6">
          <div className="flex items-start justify-between gap-4 border-b border-[#48383e] pb-5">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#c3946c]">
                 <BookOpen size={14} /> Step 1 · Choose chapters
              </div>
               <h2 className="mt-2 font-serif text-[25px] tracking-[-0.02em] text-[#f0dfce]">Choose what becomes audio</h2>
              <p className="mt-1.5 text-[11px] leading-relaxed text-[#9d8d88]">You can always make another edition with a different selection.</p>
            </div>
            <span className="rounded-full bg-[#45343a] px-3 py-1.5 text-[10px] font-semibold text-[#d8b58e]">{selected.length} selected</span>
          </div>

          <div className="mt-5 space-y-2">
            {chapterList.map((chapter, index) => {
              const active = selected.includes(index);
              return (
                <button
                  type="button"
                  key={chapter.number}
                  onClick={() => toggleChapter(index)}
                  className={`group flex w-full items-center gap-3 rounded-xl border px-3.5 py-3 text-left transition ${
                    active ? "border-[#9c694f] bg-[#443238]" : "border-transparent bg-[#352d32] hover:border-[#62494c]"
                  }`}
                >
                  <span className={`flex h-7 w-7 items-center justify-center rounded-full font-mono text-[10px] ${active ? "bg-[#d79a61] text-[#30211e]" : "bg-[#4b3a3f] text-[#a9968e]"}`}>
                    {active ? <Check size={13} strokeWidth={3} /> : chapter.number}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block text-[12px] font-semibold ${active ? "text-[#f0d7bd]" : "text-[#b7a7a1]"}`}>{chapter.title}</span>
                    <span className="mt-0.5 block text-[10px] text-[#887a78]">Chapter {chapter.number}</span>
                  </span>
                  <span className="flex items-center gap-1.5 text-[10px] text-[#96837d]"><Clock3 size={12} /> {chapter.duration}</span>
                </button>
              );
            })}
          </div>

          <div className="mt-6 border-t border-[#48383e] pt-5">
             <div className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#c3946c]"><Sparkles size={14} /> Step 2 · Retelling direction</div>
            <div className="grid gap-4 sm:grid-cols-2">
               <SelectField label="Retelling language" icon={Languages} value={language} options={["Hindi · Hinglish", "Hindi", "Hinglish", "English"]} onChange={(value) => { setLanguage(value); updateProduct({ language: value, activityLabel: `Retelling language set to ${value}` }); }} />
               <SelectField label="Storytelling style" icon={WandSparkles} value={style} options={["Natural storytelling", "Poetic and atmospheric", "Simple and intimate"]} onChange={setStyle} />
               <SelectField label="Step 3 · Narrator voice" icon={Mic2} value={voice} options={["Ananya · warm, close", "Kabir · low, unhurried", "Meera · bright, intimate"]} onChange={(value) => { setVoice(value); updateProduct({ voice: value, activityLabel: `Voice set to ${value}` }); }} />
              <SelectField label="Pacing" icon={Clock3} value={pace} options={["Unhurried", "Measured", "Lively"]} onChange={setPace} />
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-[#4a3c40] bg-[#352d32] px-4 py-3.5">
            <div className="flex items-start gap-3">
              <Info size={15} className="mt-0.5 shrink-0 text-[#c99468]" />
              <div>
                <div className="text-[11px] font-semibold text-[#d9c1af]">A little room for the original</div>
                 <p className="mt-1 text-[10px] leading-relaxed text-[#958582]">The retelling keeps the emotional shape of the book, preserves dialogue as speech, and is sized around ~450 source words per quality chunk.</p>
              </div>
            </div>
          </div>
        </section>

        <aside className="space-y-5">
          <div className="rounded-2xl border border-[#d5c3b3] bg-[#e9ded1] p-5 text-[#4b3935] shadow-[0_18px_42px_rgba(25,16,17,.12)]">
            <div className="flex items-start gap-4">
              <BookCover label={"THE\nCARTOGRAPHER'S\nDAUGHTER"} />
              <div className="min-w-0 pt-1">
                <div className="text-[9px] font-bold uppercase tracking-[0.19em] text-[#9d7763]">Your source</div>
                <h3 className="mt-2 font-serif text-[20px] leading-[1.05] text-[#5c433a]">The Cartographer&apos;s Daughter</h3>
                <p className="mt-2 text-[11px] text-[#967b70]">Elena Voss</p>
              </div>
            </div>
            <div className="mt-5 border-t border-[#d6c4b4] pt-4">
              <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.16em] text-[#9b8176]"><span>Estimated result</span><span className="text-[#ae704e]">{selected.length ? `${Math.max(1, Math.round(totalMinutes * 0.9))} min` : "—"}</span></div>
               <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-[#70584e]"><span>{selected.length} of {product.totalChapters} chapters</span><span className="text-right">{language}</span></div>
              <ProgressBar value={Math.min(100, selected.length / 12 * 100)} />
               <div className="mt-4 rounded-xl border border-[#d1bba8] bg-[#f1e5d8] px-3 py-2.5 text-[10px] leading-relaxed text-[#826d60]">
                 <span className="font-bold text-[#755546]">Estimated tokens:</span> {selected.length ? `${(selected.length * 6.1).toFixed(1)}k of 100k daily` : "—"}
                 <span className="mx-2 text-[#b69a86]">·</span>
                 sized for ~450-word quality chunks
               </div>
            </div>
          </div>

          <div className="rounded-2xl border border-[#4b3b40] bg-[#30272d] p-5">
            <div className="flex items-center justify-between">
                <div><div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#a58d83]">Step 4 · Voice & advanced settings</div><p className="mt-1 text-[11px] text-[#827574]">Shape the narration without hiding the real controls.</p></div>
              <span className="rounded-full bg-[#44353a] px-2.5 py-1 text-[9px] text-[#a89388]">Optional</span>
            </div>
            <div className="mt-5 space-y-4">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span><span className="block text-[11px] font-semibold text-[#d3bdb0]">Keep original text in pauses</span><span className="mt-1 block text-[10px] text-[#887876]">Let key lines breathe in English.</span></span>
                <input type="checkbox" checked={includeOriginal} onChange={(event) => setIncludeOriginal(event.target.checked)} className="h-4 w-4 accent-[#d89c61]" />
              </label>
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span><span className="block text-[11px] font-semibold text-[#d3bdb0]">Include chapter notes</span><span className="mt-1 block text-[10px] text-[#887876]">Add a quiet note between chapters.</span></span>
                <input type="checkbox" checked={chapterNotes} onChange={(event) => setChapterNotes(event.target.checked)} className="h-4 w-4 accent-[#d89c61]" />
              </label>
               <div className="border-t border-[#493a3f] pt-4">
                 <div className="mb-3 flex items-center justify-between">
                   <span className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#9b867f]">Prosody</span>
                   <button type="button" className="rounded-lg border border-[#67504b] px-2.5 py-1.5 text-[9px] font-bold text-[#d9b28a] hover:bg-[#49373a]">Preview 5 sec</button>
                 </div>
                 <div className="space-y-3">
                   <label className="flex items-center gap-3 text-[10px] text-[#aa9892]"><span className="w-14">Rate</span><input aria-label="Speaking rate" type="range" min="-20" max="20" value={rate} onChange={(event) => setRate(Number(event.target.value))} className="flex-1 accent-[#d89c61]" /><span className="w-8 text-right font-mono text-[#d2ae83]">{rate > 0 ? "+" : ""}{rate}%</span></label>
                   <label className="flex items-center gap-3 text-[10px] text-[#aa9892]"><span className="w-14">Pitch</span><input aria-label="Voice pitch" type="range" min="-10" max="10" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} className="flex-1 accent-[#d89c61]" /><span className="w-8 text-right font-mono text-[#d2ae83]">{pitch > 0 ? "+" : ""}{pitch}</span></label>
                   <label className="flex items-center gap-3 text-[10px] text-[#aa9892]"><span className="w-14">Volume</span><input aria-label="Voice volume" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="flex-1 accent-[#d89c61]" /><span className="w-8 text-right font-mono text-[#d2ae83]">{volume}%</span></label>
                 </div>
               </div>
            </div>
          </div>

          <button
            type="button"
            disabled={!selected.length}
            onClick={() => {
              setGenerated(true);
              updateProduct({
                language,
                voice,
                generationStatus: "running",
                generationStage: "Prepare",
                generationStageNumber: 1,
                generationProgress: 8,
                activityLabel: `Audiobook job queued for Chapter ${product.selectedChapterNumber}`,
              });
            }}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#e4b06a] px-5 py-4 text-[12px] font-bold text-[#30231f] shadow-[0_10px_22px_rgba(180,113,67,.14)] transition hover:-translate-y-0.5 hover:bg-[#efbd78] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {generated ? <Check size={16} /> : <Headphones size={16} />}
             {generated ? "Audiobook job queued" : "Generate audiobook"}
          </button>
          <p className="text-center text-[10px] leading-relaxed text-[#817471]">{generated ? "Each chapter will move through Prepare → Retell → Narrate → Stitch → Index. Your job is saved." : "This creates persistent audio chapters. Read and Read Aloud remain available immediately."}</p>
        </aside>
      </div>
    </AppLayout>
  );
}