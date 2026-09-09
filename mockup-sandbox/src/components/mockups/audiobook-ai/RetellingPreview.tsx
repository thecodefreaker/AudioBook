import { useState } from "react";
import {
  ArrowLeft,
  Check,
  ChevronDown,
  Clock3,
  Edit3,
  Headphones,
  Pause,
  Play,
  Sparkles,
  Volume2,
  WandSparkles,
} from "lucide-react";
import { AppLayout, BookCover, ProgressBar } from "./_shared/AppLayout";

const sourceExcerpt =
  "At eleven minutes past midnight, the train slid out of the station without a sound. Mira watched the city gather itself in the window: blue shopfronts, sleeping balconies, the occasional yellow square of a room where someone was still awake.";

const initialRetelling =
  "रात के ग्यारह बजकर ग्यारह मिनट पर ट्रेन स्टेशन से बिना किसी आवाज़ के निकल गई। मीरा खिड़की के बाहर शहर को धीरे-धीरे सिमटते हुए देखती रही — नीली दुकानों की रोशनी, सोई हुई बालकनियाँ, और कभी-कभी किसी जागते कमरे की पीली रोशनी।";

function Step({ number, label, detail, active }: { number: string; label: string; detail: string; active?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`flex h-7 w-7 items-center justify-center rounded-full border text-[10px] font-bold ${active ? "border-[#e4b06a] bg-[#e4b06a] text-[#2b2020]" : "border-[#685158] text-[#c5aaa0]"}`}>
        {number}
      </div>
      <div>
        <div className={`text-[10px] font-bold uppercase tracking-[0.16em] ${active ? "text-[#f0d2aa]" : "text-[#b9a59e]"}`}>{label}</div>
        <div className="mt-0.5 text-[10px] text-[#83757a]">{detail}</div>
      </div>
    </div>
  );
}

export function RetellingPreview() {
  const [retelling, setRetelling] = useState(initialRetelling);
  const [voice, setVoice] = useState("Ananya");
  const [scriptSource, setScriptSource] = useState<"ai" | "custom">("ai");
  const [playing, setPlaying] = useState(false);
  const [generated, setGenerated] = useState(false);
  const [saved, setSaved] = useState(false);

  return (
    <AppLayout active="Create Audio" eyebrow="Create audio  /  Chapter 03" title="Review the story before it speaks." subtitle="Compare the original chapter with its retelling, or use your own script. Every saved version stays traceable to the audio it creates.">
      <div className="mb-7 flex flex-wrap items-center justify-between gap-4 border-y border-[#493b42] py-4">
        <div className="flex items-center gap-3">
          <BookCover label={"THE\nCARTOGRAPHER"} />
          <div>
            <div className="text-[12px] font-semibold text-[#ead7c2]">The Cartographer&apos;s Daughter</div>
            <div className="mt-1 text-[10px] text-[#94868a]">Elena Voss · Chapter 03 — The Letter in the Wall</div>
          </div>
        </div>
        <div className="flex items-center gap-6 text-[10px] uppercase tracking-[0.17em] text-[#94838a]">
          <span>21 min chapter</span>
          <span className="hidden h-4 w-px bg-[#54444a] sm:block" />
          <span className="text-[#d6b184]">Draft preview</span>
        </div>
      </div>

      <div className="mb-7 flex flex-col gap-4 rounded-2xl border border-[#493b42] bg-[#30272d] px-5 py-4 sm:flex-row sm:items-center sm:gap-4">
        <Step number="01" label="Original chapter" detail="Elena Voss · English" />
        <div className="hidden h-px min-w-8 flex-1 bg-[#655057] sm:block" />
        <Step number="02" label="AI retelling" detail="Hindi · Hinglish" active />
        <div className="hidden h-px min-w-8 flex-1 bg-[#655057] sm:block" />
        <Step number="03" label="Narration" detail="Ananya · warm, close" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[1.08fr_.92fr]">
        <section className="rounded-2xl border border-[#cdbbaa] bg-[#eee3d5] p-5 text-[#473a38] shadow-[0_18px_42px_rgba(16,11,14,.15)] sm:p-7">
          <div className="flex items-center justify-between border-b border-[#d8c6b4] pb-4">
             <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#9b705d]"><WandSparkles size={14} /> {scriptSource === "ai" ? "AI retelling preview" : "Custom script preview"}</div>
            <button type="button" onClick={() => setSaved(!saved)} className="flex items-center gap-1.5 text-[10px] font-semibold text-[#8b6655] hover:text-[#65493e]">
              {saved ? <Check size={13} /> : <Edit3 size={13} />} {saved ? "Saved" : "Save edits"}
            </button>
          </div>
             <div className="mt-5 flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="font-mono text-[9px] font-bold uppercase tracking-[0.2em] text-[#ae7b61]">Script v03 · {scriptSource === "ai" ? "AI retelling" : "Custom script"} · 01:42</div>
               <h2 className="mt-2 font-serif text-[28px] leading-none text-[#4c3b37]">The train leaves quietly</h2>
            </div>
            <span className="rounded-full bg-[#e1d0bf] px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.12em] text-[#916852]">Editable</span>
          </div>
           <div className="mt-4 flex gap-2 rounded-xl bg-[#e4d4c4] p-1">
             <button type="button" onClick={() => setScriptSource("ai")} className={`rounded-lg px-3 py-2 text-[10px] font-bold ${scriptSource === "ai" ? "bg-[#f6ece2] text-[#725142]" : "text-[#9a7968]"}`}>AI retelling</button>
             <button type="button" onClick={() => setScriptSource("custom")} className={`rounded-lg px-3 py-2 text-[10px] font-bold ${scriptSource === "custom" ? "bg-[#f6ece2] text-[#725142]" : "text-[#9a7968]"}`}>Custom script</button>
           </div>
          <textarea aria-label="Editable Hindi Hinglish retelling" value={retelling} onChange={(e) => setRetelling(e.target.value)} className="mt-6 min-h-[150px] w-full resize-none rounded-xl border border-[#d8c4b1] bg-[#f5ece2] p-4 font-serif text-[18px] leading-[1.65] text-[#58443e] outline-none transition focus:border-[#b57659] focus:ring-2 focus:ring-[#c79370]/20" />
           <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-[10px] text-[#9d877b]">
              <span>{scriptSource === "ai" ? "Devanagari Hinglish · dialogue stays dialogue" : "Exact user text · no AI rewrite"}</span>
            <span>{retelling.length} characters</span>
          </div>
           <div className="mt-4 rounded-xl border border-[#d6b99b] bg-[#f7eadc] px-3.5 py-3 text-[10px] leading-relaxed text-[#806c61]">
             <span className="font-bold text-[#725142]">Version-safe editing:</span> saving creates a new custom script version. The original and prior AI drafts stay intact, and generated audio remains pinned to its exact script.
           </div>
          <div className="mt-6 border-t border-[#d8c6b4] pt-5">
             <div className="mb-3 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.18em] text-[#a18172]"><BookCover label={"THE\nLETTER"} /> Source excerpt · English</div>
            <p className="font-serif text-[14px] leading-[1.7] text-[#756057]">{sourceExcerpt}</p>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-[#4b3b42] bg-[#30272d] p-5 sm:p-6">
            <div className="flex items-start justify-between">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#b48e6c]"><Headphones size={14} /> Step 3 · Narration</div>
                <h2 className="mt-3 font-serif text-[27px] text-[#f0ddc9]">Find its voice.</h2>
              </div>
              <Volume2 size={18} className="text-[#9a7163]" />
            </div>
            <label className="mt-6 block text-[9px] font-bold uppercase tracking-[0.17em] text-[#9e8985]">Narrator voice
              <div className="relative mt-2">
                <select value={voice} onChange={(e) => setVoice(e.target.value)} className="w-full appearance-none rounded-xl border border-[#58464c] bg-[#3a2e35] px-4 py-3 text-[12px] text-[#ecdacc] outline-none focus:border-[#c08a60]">
                 <option>Ananya · warm, close</option><option>Kabir · low, unhurried</option><option>Meera · bright, intimate</option>
                </select>
                <ChevronDown size={15} className="pointer-events-none absolute right-3 top-3.5 text-[#a28e88]" />
              </div>
            </label>
            <div className="mt-4 flex items-center gap-3 rounded-xl border border-[#57464b] bg-[#352a30] p-3">
              <button type="button" aria-label={playing ? "Pause preview" : "Play preview"} onClick={() => setPlaying(!playing)} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#e4b06a] text-[#2b2020] hover:bg-[#f0c27b]">{playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}</button>
              <div className="min-w-0 flex-1"><div className="flex h-7 items-center gap-[3px]">{Array.from({ length: 27 }).map((_, i) => <i key={i} className="w-[3px] rounded-full bg-[#b9785b]" style={{ height: `${7 + ((i * 11) % 17)}px` }} />)}</div><div className="mt-1 flex justify-between text-[9px] text-[#907f7d]"><span>{playing ? "00:18" : "00:00"}</span><span>01:42</span></div></div>
            </div>
            <div className="mt-5 flex gap-3">
              <button type="button" onClick={() => setPlaying(!playing)} className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#6a5150] px-4 py-3 text-[11px] font-bold text-[#e2c5ab] hover:border-[#d09a69]"><Play size={14} /> {playing ? "Pause preview" : "Preview narration"}</button>
               <button type="button" onClick={() => { setGenerated(true); setPlaying(false); }} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#e4b06a] px-4 py-3 text-[11px] font-bold text-[#30231f] hover:bg-[#f0c27b]"><Sparkles size={14} /> {scriptSource === "ai" ? "Generate audio" : "Save & generate audio"}</button>
            </div>
            {generated && <div className="mt-4 flex items-center gap-2 text-[10px] text-[#a6c19e]"><Check size={14} /> Audio added to your chapter queue.</div>}
          </section>
          <section className="rounded-2xl border border-[#493b42] bg-[#2b242a] p-5">
            <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.17em] text-[#99858a]"><span>Chapter progress</span><span className="text-[#d7b184]">46%</span></div>
            <div className="mt-3"><ProgressBar value={46} /></div>
            <div className="mt-3 flex items-center gap-2 text-[10px] text-[#817579]"><Clock3 size={13} /> 3h 12m left in the book</div>
          </section>
        </aside>
      </div>

      <button type="button" className="mt-7 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.17em] text-[#927c7c] hover:text-[#e1bd90]"><ArrowLeft size={14} /> Back to retelling studio</button>
    </AppLayout>
  );
}