import { useMemo, useState } from "react";
import {
  Check,
  ChevronRight,
  Clock3,
  FileAudio,
  Headphones,
  LibraryBig,
  Play,
  Search,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { AppLayout, BookCover, ProgressBar } from "./_shared/AppLayout";

type Filter = "All" | "Unread" | "Needs audio";

const chapters = [
  { no: "01", title: "The Night Train", pages: "1–14", duration: "18 min", read: true, listening: true, generated: true, excerpt: "At eleven minutes past midnight, the train slid out of the station without a sound." },
  { no: "02", title: "A House of Blue Light", pages: "15–31", duration: "24 min", read: true, listening: true, generated: true, excerpt: "The house stood beyond the last streetlamp, its windows holding the blue of a late winter moon." },
  { no: "03", title: "The Letter in the Wall", pages: "32–48", duration: "21 min", read: true, listening: false, generated: false, excerpt: "Mira found the envelope behind a loose brick, where the plaster had begun to breathe dust." },
  { no: "04", title: "What the River Keeps", pages: "49–66", duration: "27 min", read: true, listening: false, generated: false, excerpt: "By morning, the river had changed its mind about the bridge." },
  { no: "05", title: "Morning, Somewhere Else", pages: "67–82", duration: "19 min", read: false, listening: false, generated: false, excerpt: "She woke with the taste of iron and a map folded beneath her cheek." },
  { no: "06", title: "The Latitude of Leaving", pages: "83–99", duration: "22 min", read: false, listening: false, generated: false, excerpt: "Every map is an argument about what deserves to be remembered." },
  { no: "07", title: "Salt on the Compass", pages: "100–116", duration: "25 min", read: false, listening: false, generated: false, excerpt: "The compass needle trembled as if it had heard a name." },
  { no: "08", title: "A Country of Small Roads", pages: "117–132", duration: "20 min", read: false, listening: false, generated: false, excerpt: "They took the small roads because the larger ones belonged to other people's stories." },
  { no: "09", title: "The Unmapped Coast", pages: "133–149", duration: "23 min", read: false, listening: false, generated: false, excerpt: "At the coast, the horizon offered no instructions." },
  { no: "10", title: "Names for the Dark", pages: "150–164", duration: "17 min", read: false, listening: false, generated: false, excerpt: "Her father had given every darkness a name, and none of them were warnings." },
  { no: "11", title: "The Cartographer's Room", pages: "165–181", duration: "26 min", read: false, listening: false, generated: false, excerpt: "The room was smaller than memory, crowded with the instruments of a life." },
  { no: "12", title: "Where the Lines Meet", pages: "182–192", duration: "16 min", read: false, listening: false, generated: false, excerpt: "When the lines finally met, Mira understood that arrival was not the opposite of leaving." },
];

function Status({ yes, kind }: { yes: boolean; kind: "read" | "audio" | "generated" }) {
  const label = kind === "read" ? "Read" : kind === "audio" ? "Read aloud" : "Audiobook";
  return (
    <span className={`inline-flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-[0.13em] ${yes ? "text-[#66836f]" : "text-[#aa9588]"}`}>
      {yes ? <Check size={12} strokeWidth={2.6} /> : <span className="h-1.5 w-1.5 rounded-full border border-current" />}
      {yes ? label : kind === "generated" ? "Not made" : "To do"}
    </span>
  );
}

export function ChapterNavigator() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [selected, setSelected] = useState(2);
  const [toast, setToast] = useState("");
  const active = chapters[selected];
  const visible = useMemo(() => chapters.filter((chapter) => {
    const matches = `${chapter.no} ${chapter.title}`.toLowerCase().includes(query.toLowerCase());
    const filtered = filter === "All" || (filter === "Unread" ? !chapter.read : !chapter.generated);
    return matches && filtered;
  }), [filter, query]);

  const announce = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2200);
  };

  return (
    <AppLayout active="Library" eyebrow="The Cartographer's Daughter · 12 chapters" title="Chapter navigator" subtitle="A clear place to return to the story — and to see which passages are ready to become a voice.">
      <div className="grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,.8fr)]">
        <section className="min-w-0 overflow-hidden rounded-2xl border border-[#514148] bg-[#322a2f] shadow-[0_18px_40px_rgba(20,13,18,.16)]">
          <div className="border-b border-[#4a3b40] p-4 sm:p-5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#d3a06f]">Your reading map</div>
                <p className="mt-1 text-[11px] text-[#9e8d88]">4 chapters read · 2 audio drafts ready</p>
              </div>
              <div className="relative w-full sm:w-[210px]">
                <Search size={14} className="absolute left-3 top-3 text-[#9b8883]" />
                <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a chapter" className="w-full rounded-xl border border-[#57464a] bg-[#292328] py-2.5 pl-9 pr-3 text-[11px] text-[#eadcd2] outline-none placeholder:text-[#796b6b] focus:border-[#bc845b]" />
              </div>
            </div>
            <div className="mt-4 flex items-center gap-1 rounded-xl bg-[#292328] p-1">
              {(["All", "Unread", "Needs audio"] as Filter[]).map((item) => <button type="button" key={item} onClick={() => setFilter(item)} className={`rounded-lg px-3 py-2 text-[10px] font-semibold transition ${filter === item ? "bg-[#e4b06a] text-[#30231f]" : "text-[#a9958d] hover:text-[#e8d6c5]"}`}>{item}</button>)}
            </div>
          </div>
          <div className="divide-y divide-[#44373c]">
            {visible.map((chapter) => {
              const index = chapters.indexOf(chapter);
              return <button type="button" key={chapter.no} onClick={() => setSelected(index)} className={`grid w-full grid-cols-[34px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-3.5 text-left transition sm:grid-cols-[38px_minmax(0,1fr)_104px_86px] sm:px-5 ${selected === index ? "bg-[#49383d]" : "hover:bg-[#3b3035]"}`}>
                <span className={`font-mono text-[10px] ${selected === index ? "text-[#e4b06a]" : "text-[#897a78]"}`}>{chapter.no}</span>
                <span className="min-w-0"><span className={`block truncate text-[12px] font-semibold ${selected === index ? "text-[#f1dec9]" : "text-[#cbbab0]"}`}>{chapter.title}</span><span className="mt-1 block text-[10px] text-[#887a78]">{chapter.pages} · {chapter.duration}</span></span>
                <span className="hidden sm:block"><Status yes={chapter.read} kind="read" /></span>
                <span className="flex justify-end"><Status yes={chapter.generated} kind="generated" /></span>
              </button>;
            })}
          </div>
          {visible.length === 0 && <div className="p-10 text-center text-[12px] text-[#9e8d88]">No chapters match that search.</div>}
        </section>

        <aside className="rounded-2xl border border-[#d2c0ae] bg-[#eee2d4] p-5 text-[#4c3b37] shadow-[0_18px_45px_rgba(20,13,18,.13)] sm:p-6">
          <div className="flex items-start gap-4 border-b border-[#d7c5b3] pb-5">
            <BookCover label={"THE\nCARTO-\nGRAPHER"} />
            <div className="min-w-0 pt-1"><div className="text-[9px] font-bold uppercase tracking-[0.2em] text-[#a06e51]">Selected chapter</div><h2 className="mt-2 font-serif text-[25px] leading-[1.02] text-[#573e37]">{active.title}</h2><p className="mt-2 text-[11px] text-[#90786c]">Chapter {active.no} · {active.pages} · {active.duration}</p></div>
          </div>
          <div className="mt-5 rounded-xl border border-[#d7c4b0] bg-[#e7d8c8] p-4"><div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.16em] text-[#9d7d6c]"><span>Chapter progress</span><span className="text-[#b47650]">{active.read ? "100%" : "0%"}</span></div><div className="mt-2"><ProgressBar value={active.read ? 100 : 0} tone="gold" /></div><p className="mt-3 font-serif text-[16px] leading-relaxed text-[#5d4840]">“{active.excerpt}”</p></div>
           <div className="mt-5 space-y-3"><div className="flex items-center justify-between"><Status yes={active.read} kind="read" /><span className="text-[10px] text-[#947b70]">Original text</span></div><div className="flex items-center justify-between"><Status yes={active.listening} kind="audio" /><span className="text-[10px] text-[#947b70]">Temporary TTS</span></div><div className="flex items-center justify-between"><Status yes={active.generated} kind="generated" /><span className="text-[10px] text-[#947b70]">Saved Hindi / Hinglish</span></div></div>
           <div className="mt-6 flex gap-2"><button type="button" onClick={() => announce(`Opening ${active.title}`)} className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-[#5a403b] px-3 py-3 text-[11px] font-bold text-[#f5dfc9] transition hover:bg-[#6b4940]"><LibraryBig size={14} /> Read chapter</button><button type="button" onClick={() => announce(active.generated ? "Opening Create Audio" : "Create Audio is ready")} className="flex h-11 w-11 items-center justify-center rounded-xl border border-[#bda28e] text-[#765448] transition hover:bg-[#dfcdbc]" aria-label="Create audio"><WandSparkles size={16} /></button></div>
           <button type="button" onClick={() => announce(active.listening ? "Reading original text aloud" : "Read aloud is ready from the chapter")} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-[#c5aa94] py-3 text-[11px] font-semibold text-[#7c5b4d] hover:bg-[#e4d3c2]"><Play size={14} fill="currentColor" /> Read aloud · no audiobook required</button>
        </aside>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#4a3b40] bg-[#30272c] px-4 py-3 text-[10px] text-[#a28d87]"><span className="flex items-center gap-2"><Headphones size={14} className="text-[#d4a16e]" /> Original narration follows the text exactly. Drafts are adapted with care.</span><span className="flex items-center gap-2 text-[#c09b79]"><Clock3 size={13} /> 4h 05m total listening time <ChevronRight size={13} /></span></div>
      {toast && <div className="fixed bottom-5 right-5 z-50 flex items-center gap-2 rounded-xl border border-[#74534a] bg-[#3f3035] px-4 py-3 text-[11px] text-[#f1ddc7] shadow-2xl"><Sparkles size={14} className="text-[#e4b06a]" />{toast}</div>}
    </AppLayout>
  );
}