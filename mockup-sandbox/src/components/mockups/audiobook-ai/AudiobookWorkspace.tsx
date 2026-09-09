import { useState, type ReactNode } from "react";
import {
  BookOpen,
  Bookmark,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  CircleHelp,
  Headphones,
  Home,
  Library,
  ListMusic,
  Menu,
  Mic2,
  MoreHorizontal,
  Pause,
  Play,
  Search,
  Settings2,
  Sparkles,
  StickyNote,
  Volume2,
  WandSparkles,
  X,
} from "lucide-react";

type Mode = "Read" | "Listen" | "Create Audio";
type Destination = "Home" | "Library" | "Create Audio" | "Settings";

const chapters = [
  { no: "01", title: "The Night Train", time: "18 min", done: true },
  { no: "02", title: "A House of Blue Light", time: "24 min", done: true },
  { no: "03", title: "The Letter in the Wall", time: "21 min", done: false },
  { no: "04", title: "What the River Keeps", time: "27 min", done: false },
  { no: "05", title: "Morning, Somewhere Else", time: "19 min", done: false },
];

const originalCopy = [
  "At eleven minutes past midnight, the train slid out of the station without a sound.",
  "Mira watched the city gather itself in the window: blue shopfronts, sleeping balconies, the occasional yellow square of a room where someone was still awake.",
  "She had promised herself she would not look back. Still, when the last platform lamp disappeared, her hand found the small envelope in her coat pocket.",
  "On its front, in her father's unmistakable handwriting, were six words: You will know when you arrive.",
];

const retoldCopy = [
  "Raat ke gyaarah bajkar gyarah minute par train bina kisi aawaaz ke station se nikal gayi.",
  "Mira ne khidki mein shehar ko khud ko samet-te dekha — neeli dukaanen, soyi hui balconies, aur kabhi-kabhi kisi jaagte kamre ki peeli roshni.",
  "Usne khud se vaada kiya tha ki woh peeche mudkar nahi dekhegi. Phir bhi, platform ki aakhri roshni gayab hote hi uska haath coat ki jeb mein rakhe chhote lifaafe tak pahunch gaya.",
  "Us par uske pita ki pehchaani hui handwriting mein chhe shabd the: Tum pahunchoge toh samajh jaaoge.",
];

function ModeButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className={`rounded-full px-4 py-2 text-[11px] font-bold tracking-[0.08em] transition ${active ? "bg-[#e4b06a] text-[#2b2020] shadow-[0_5px_16px_rgba(228,176,106,.16)]" : "text-[#b9aaa4] hover:bg-[#40353a] hover:text-[#f1e2d5]"}`}>
      {children}
    </button>
  );
}

function AudioWave({ muted = false }: { muted?: boolean }) {
  return <div className={`flex h-10 items-center gap-[3px] ${muted ? "opacity-40" : ""}`}>{Array.from({ length: 34 }).map((_, index) => <i key={index} className="w-[3px] rounded-full bg-[#c4875d]" style={{ height: `${8 + ((index * 19) % 25)}px` }} />)}</div>;
}

export function AudiobookWorkspace() {
  const [mode, setMode] = useState<Mode>("Read");
  const [destination, setDestination] = useState<Destination>("Library");
  const [playing, setPlaying] = useState(false);
  const [readAloud, setReadAloud] = useState<"idle" | "preparing" | "playing">("idle");
  const [readerView, setReaderView] = useState<"original" | "retold">("original");
  const [readerTheme, setReaderTheme] = useState<"paper" | "sepia" | "night">("paper");
  const [fontSize, setFontSize] = useState(19);
  const [fontFamily, setFontFamily] = useState<"serif" | "sans">("serif");
  const [lineHeight, setLineHeight] = useState(1.85);
  const [fullscreen, setFullscreen] = useState(false);
  const [chapter, setChapter] = useState(2);
  const [progress, setProgress] = useState(38);
  const [language, setLanguage] = useState("Hindi");
  const [voice, setVoice] = useState("Ananya · warm, close");
  const [draft, setDraft] = useState(false);
  const [navOpen, setNavOpen] = useState(false);
  const [chaptersOpen, setChaptersOpen] = useState(true);
  const activeChapter = chapters[chapter];

  const changeMode = (next: Mode) => {
    setMode(next);
    setDestination(next === "Create Audio" ? "Create Audio" : "Library");
    if (next === "Create Audio") {
      setPlaying(false);
      setReadAloud("idle");
    }
  };

  const startReadAloud = () => {
    if (readAloud === "playing") {
      setReadAloud("idle");
      return;
    }
    setReadAloud("preparing");
    window.setTimeout(() => setReadAloud("playing"), 850);
  };

  return (
    <main className="min-h-[100dvh] overflow-hidden bg-[#241f23] text-[#eee4d9]" style={{ fontFamily: "'DM Sans', ui-sans-serif, system-ui, sans-serif" }}>
      <header className="flex h-[64px] items-center justify-between border-b border-[#3f353a] bg-[#2c262b] px-4 sm:px-7">
        <div className="flex items-center gap-3">
          <button type="button" aria-label="Open navigation" onClick={() => setNavOpen(!navOpen)} className="rounded-lg p-2 text-[#b9aaa4] hover:bg-[#40353a] lg:hidden">{navOpen ? <X size={18} /> : <Menu size={18} />}</button>
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-[#e4b06a] text-[#2b2020]"><Headphones size={18} strokeWidth={2.4} /></div>
          <div><div className="text-[13px] font-bold tracking-[0.15em] text-[#f3e9de]">AUDIOBOOK <span className="text-[#e4b06a]">AI</span></div><div className="mt-0.5 hidden text-[9px] uppercase tracking-[0.2em] text-[#877b78] sm:block">your reading room</div></div>
        </div>
        <nav className="hidden items-center gap-1 rounded-full bg-[#362f34] p-1 sm:flex">
          {(["Read", "Listen", "Create Audio"] as Mode[]).map((item) => <ModeButton key={item} active={mode === item} onClick={() => changeMode(item)}>{item}</ModeButton>)}
        </nav>
        <div className="flex items-center gap-1 text-[#a99d98]"><button type="button" aria-label="Search" className="hidden rounded-lg p-2 hover:bg-[#40353a] sm:block"><Search size={17} /></button><button type="button" aria-label="Help" className="rounded-lg p-2 hover:bg-[#40353a]"><CircleHelp size={17} /></button><div className="ml-1 flex h-8 w-8 items-center justify-center rounded-full bg-[#765b54] text-[11px] font-bold text-[#f7dfc4]">RK</div></div>
      </header>

      <div className="border-b border-[#473b3e] bg-[#30292e] px-4 py-3 sm:px-7">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3"><button type="button" aria-label="Back to library" onClick={() => setDestination("Library")} className="hidden text-[#a99790] hover:text-[#e4b06a] sm:block"><ChevronLeft size={17} /></button><div className="h-9 w-7 shrink-0 bg-[#b87350] text-center font-serif text-[7px] leading-tight text-[#fbe4c6] shadow-inner">THE<br />CARTO-<br />GRAPHER</div><div className="min-w-0"><div className="truncate text-[12px] font-semibold text-[#ead7c2]">The Cartographer&apos;s Daughter</div><div className="mt-0.5 text-[10px] text-[#978983]">Elena Voss <span className="mx-1.5 text-[#6e6060]">·</span> Chapter {activeChapter.no} of 12</div></div></div>
          <div className="hidden items-center gap-5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#948682] md:flex"><button type="button" onClick={() => setChaptersOpen(!chaptersOpen)} className="hover:text-[#e4b06a]">{chaptersOpen ? "Hide chapters" : "Show chapters"}</button><span className="h-4 w-px bg-[#504346]" /><span className="text-[#d4b38b]">{mode === "Create Audio" ? "Retelling studio" : mode === "Listen" ? "Listening room" : "Reading mode"}</span></div>
          <div className="sm:hidden"><ModeButton active={false} onClick={() => changeMode(mode === "Read" ? "Listen" : mode === "Listen" ? "Create Audio" : "Read")}>{mode}</ModeButton></div>
        </div>
      </div>

      <div className="relative flex min-h-[calc(100dvh-140px)]">
        <aside className={`${navOpen ? "flex" : "hidden"} absolute inset-y-0 left-0 z-20 w-[245px] flex-col border-r border-[#42373b] bg-[#282328] p-4 shadow-2xl lg:relative lg:flex`}>
          <div className="mb-3 px-2 text-[9px] font-bold uppercase tracking-[0.22em] text-[#817574]">Navigate</div>
          {([
             ["Home", Home], ["Library", Library], ["Create Audio", WandSparkles], ["Settings", Settings2],
          ] as const).map(([label, Icon]) => <button type="button" key={label} onClick={() => { setDestination(label); if (label === "Create Audio") changeMode("Create Audio"); else if (label === "Library") changeMode("Read"); setNavOpen(false); }} className={`mb-1 flex items-center gap-3 rounded-xl px-3 py-2.5 text-left text-[11px] transition ${destination === label ? "bg-[#443238] text-[#f0d3ad]" : "text-[#a29793] hover:bg-[#362e33] hover:text-[#ead8ca]"}`}><Icon size={15} />{label}{label === "Library" && <span className="ml-auto text-[9px] text-[#817275]">6</span>}</button>)}
          <div className="mt-6 border-t border-[#3e3438] pt-5"><div className="mb-3 px-2 text-[9px] font-bold uppercase tracking-[0.22em] text-[#817574]">This book</div><button type="button" onClick={() => setChaptersOpen(!chaptersOpen)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[11px] text-[#c5b5ad] hover:bg-[#362e33]"><BookOpen size={15} />Chapters <ChevronDown size={14} className={`ml-auto transition ${chaptersOpen ? "rotate-180" : ""}`} /></button><button type="button" onClick={() => setMode("Read")} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[11px] text-[#a29793] hover:bg-[#362e33]"><StickyNote size={15} />Notes</button><button type="button" onClick={() => setMode("Read")} className="mt-1 flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-[11px] text-[#a29793] hover:bg-[#362e33]"><Bookmark size={15} />Bookmarks</button></div>
          <div className="mt-auto rounded-xl border border-[#4a3a3b] bg-[#34292d] p-3"><div className="text-[9px] font-bold uppercase tracking-[0.18em] text-[#95837c]">Reading progress</div><div className="mt-2 flex items-end justify-between"><span className="font-serif text-[23px] text-[#efd2ae]">46%</span><span className="text-[10px] text-[#968780]">3h 12m left</span></div><div className="mt-2 h-1 rounded-full bg-[#594145]"><div className="h-full w-[46%] rounded-full bg-[#d89c61]" /></div></div>
        </aside>

        {chaptersOpen && <aside className="hidden w-[208px] shrink-0 border-r border-[#d7c7b8] bg-[#eadfd2] px-3 py-6 text-[#55433c] md:block"><div className="flex items-center justify-between px-2"><span className="text-[9px] font-bold uppercase tracking-[0.19em] text-[#9d887b]">Chapters · 12</span><button type="button" aria-label="Collapse chapters" onClick={() => setChaptersOpen(false)} className="text-[#aa9182] hover:text-[#704d40]"><ChevronLeft size={15} /></button></div><nav className="mt-4 space-y-1">{chapters.map((item, index) => <button type="button" key={item.no} onClick={() => { setChapter(index); setMode("Read"); }} className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-3 text-left transition ${chapter === index ? "bg-[#dcc9b7] text-[#734c3e]" : "text-[#927d71] hover:bg-[#e3d4c5]"}`}><span className={`font-mono text-[10px] ${chapter === index ? "text-[#ae704e]" : "text-[#aa9588]"}`}>{item.no}</span><span className="min-w-0 flex-1 truncate text-[11px] font-medium">{item.title}</span>{item.done && <span className="text-[10px] text-[#72917c]">Read</span>}</button>)}</nav></aside>}

           {mode === "Create Audio" ? <section className="min-w-0 flex-1 overflow-y-auto bg-[#2a2429]"><div className="mx-auto max-w-[780px] px-6 pb-36 pt-9 sm:px-12 sm:pt-14"><div className="mb-8 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#b48e6c]"><Sparkles size={15} /> Create audio <ChevronRight size={13} /></div><h1 className="max-w-[600px] font-serif text-[42px] leading-[1.02] tracking-[-0.03em] text-[#f2dfca] sm:text-[60px]">Retell this chapter<br /><em className="text-[#d69a65]">in a voice of its own.</em></h1><p className="mt-5 max-w-[490px] text-[14px] leading-relaxed text-[#a99a95]">Create a natural retelling in Devanagari or mixed-script Hinglish. This is a five-stage audiobook job — not a translation and not a quick read-aloud.</p><div className="mt-8 grid grid-cols-5 gap-2">{[["1","Prepare"],["2","Retell"],["3","Narrate"],["4","Stitch"],["5","Index"]].map(([number,label], index) => <div key={number} className={`rounded-xl border px-2 py-3 ${index === 0 ? "border-[#9b6b50] bg-[#49363a]" : "border-[#493a3f] bg-[#30272d]"}`}><div className={`font-mono text-[9px] ${index === 0 ? "text-[#e1ab71]" : "text-[#847579]"}`}>{number}</div><div className="mt-2 text-[9px] font-bold uppercase tracking-[0.1em] text-[#c9b7ad]">{label}</div></div>)}</div><div className="mt-8 grid gap-4 sm:grid-cols-2"><label className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#988883]">Retelling language<div className="relative mt-2"><select value={language} onChange={(e) => setLanguage(e.target.value)} className="w-full appearance-none rounded-xl border border-[#4d3e42] bg-[#352d32] px-4 py-3.5 text-[12px] text-[#ead9cc] outline-none focus:border-[#bc845b]"><option>Hindi</option><option>Hinglish</option><option>English</option></select><ChevronDown size={15} className="pointer-events-none absolute right-3 top-4 text-[#9f8d84]" /></div></label><label className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#988883]">Narrator voice<div className="relative mt-2"><select value={voice} onChange={(e) => setVoice(e.target.value)} className="w-full appearance-none rounded-xl border border-[#4d3e42] bg-[#352d32] px-4 py-3.5 text-[12px] text-[#ead9cc] outline-none focus:border-[#bc845b]"><option>Ananya · warm, close</option><option>Kabir · low, unhurried</option><option>Meera · bright, intimate</option></select><ChevronDown size={15} className="pointer-events-none absolute right-3 top-4 text-[#9f8d84]" /></div></label></div><div className="mt-8 rounded-2xl border border-[#4c3d41] bg-[#31282d] p-5 sm:p-6"><div className="flex items-center justify-between"><div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#97847d]">Chapter {activeChapter.no} · source text</div><span className="rounded-full bg-[#43363a] px-3 py-1 text-[9px] font-bold uppercase tracking-wider text-[#b8a59b]">21 min</span></div><p className="mt-4 font-serif text-[18px] leading-relaxed text-[#dfcec0]">{originalCopy[0]} {originalCopy[1]}</p><div className="mt-5 border-t border-[#48383d] pt-4 text-[11px] text-[#988985]">The retelling will be saved as a new script version. Your original text and prior edits are never overwritten.</div></div><div className="mt-6 rounded-2xl border border-[#4c3d41] bg-[#30272d] p-5"><div className="flex items-center justify-between"><div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#99857e]">Honest estimate</div><span className="font-mono text-[10px] text-[#d5b58e]">~6.1k tokens</span></div><div className="mt-3 flex items-center gap-3"><div className="flex-1"><div className="h-1.5 rounded-full bg-[#4f3e42]"><div className="h-full w-[61%] rounded-full bg-[#d89c61]" /></div></div><span className="text-[10px] text-[#9d8b86]">61k / 100k daily</span></div><div className="mt-3 flex items-center gap-2 text-[10px] text-[#8f7f7c]"><Sparkles size={12} className="text-[#d89c61]" /> Quality-sized chunks target ~450 source words.</div></div><div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center"><button type="button" onClick={() => setDraft(true)} className="flex items-center justify-center gap-2 rounded-xl bg-[#e4b06a] px-5 py-3.5 text-[12px] font-bold text-[#30231f] transition hover:-translate-y-0.5 hover:bg-[#f0c27b]"><Sparkles size={15} />{draft ? "Retelling draft ready" : "Create retelling draft"}</button>{draft && <button type="button" onClick={() => setPlaying(!playing)} className="flex items-center justify-center gap-2 rounded-xl border border-[#5b4847] px-5 py-3.5 text-[12px] font-semibold text-[#d1b9aa] hover:border-[#ba835f]">{playing ? <Pause size={14} /> : <Play size={14} />} Preview narration</button>}</div></div></section> : <section className={`min-w-0 flex-1 overflow-y-auto ${mode === "Listen" ? "bg-[#332a2e]" : readerTheme === "night" ? "bg-[#292429]" : readerTheme === "sepia" ? "bg-[#e8d8c7]" : "bg-[#f1e8dc]"} text-[#332a28]`}><div className={`mx-auto max-w-[820px] px-6 pb-36 pt-8 sm:px-12 sm:pt-12 ${mode === "Listen" ? "text-[#f0dfd2]" : ""}`}>{mode === "Read" && <div className="mb-8 rounded-2xl border border-[#d5c2ae] bg-[#eadbca] p-3 text-[#745548]"><div className="flex flex-wrap items-center gap-2"><span className="mr-1 text-[9px] font-bold uppercase tracking-[0.18em]">Reader</span><button type="button" onClick={() => setReaderView("original")} className={`rounded-lg px-3 py-2 text-[10px] font-bold ${readerView === "original" ? "bg-[#765044] text-[#faead7]" : "text-[#896e60]"}`}>Original</button><button type="button" onClick={() => setReaderView("retold")} className={`rounded-lg px-3 py-2 text-[10px] font-bold ${readerView === "retold" ? "bg-[#765044] text-[#faead7]" : "text-[#896e60]"}`}>Retold Hindi / Hinglish</button><span className="mx-1 hidden h-5 w-px bg-[#c7ae98] sm:block" /><button type="button" onClick={() => setFontSize(Math.max(16, fontSize - 1))} className="rounded-lg border border-[#c5aa93] px-2.5 py-2 text-[10px] font-bold">A−</button><button type="button" onClick={() => setFontSize(Math.min(24, fontSize + 1))} className="rounded-lg border border-[#c5aa93] px-2.5 py-2 text-[10px] font-bold">A+</button><button type="button" onClick={() => setFontFamily(fontFamily === "serif" ? "sans" : "serif")} className="rounded-lg border border-[#c5aa93] px-2.5 py-2 text-[10px] font-bold">{fontFamily === "serif" ? "Serif" : "Sans"}</button><button type="button" onClick={() => setLineHeight(lineHeight === 1.85 ? 1.55 : 1.85)} className="rounded-lg border border-[#c5aa93] px-2.5 py-2 text-[10px] font-bold">Spacing</button><button type="button" onClick={() => setReaderTheme(readerTheme === "paper" ? "sepia" : readerTheme === "sepia" ? "night" : "paper")} className="rounded-lg border border-[#c5aa93] px-2.5 py-2 text-[10px] font-bold">Theme</button><button type="button" onClick={() => setFullscreen(!fullscreen)} className="ml-auto rounded-lg border border-[#c5aa93] px-2.5 py-2 text-[10px] font-bold">{fullscreen ? "Exit full screen" : "Full screen"}</button></div><div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-[#907568]"><span>Estimated 21 min read</span><span>·</span><span>Click a highlighted paragraph to seek audio</span><span>·</span><span>{readerView === "original" ? "Original ebook text" : "Saved retelling script"}</span></div></div>}{mode === "Listen" ? <div className="flex min-h-[600px] flex-col justify-center"><div className="mb-5 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#be956d]"><Volume2 size={15} /> Listening room</div><h1 className="font-serif text-[44px] leading-[1.02] sm:text-[67px]">The Letter<br />in the Wall</h1><p className="mt-5 text-[13px] text-[#aa9993]">Saved Hindi · Hinglish audiobook · Chapter {activeChapter.no} · {activeChapter.time}</p><div className="mt-12 rounded-2xl border border-[#57464a] bg-[#2b2429] p-6 sm:p-8"><AudioWave /><div className="mt-6 flex items-center justify-between text-[11px] text-[#a28d87]"><span>08:17</span><span>21:04</span></div><input aria-label="listening progress" type="range" min="0" max="100" value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="mt-2 w-full accent-[#e4b06a]" /><button type="button" onClick={() => setPlaying(!playing)} className="mx-auto mt-7 flex h-14 w-14 items-center justify-center rounded-full bg-[#e4b06a] text-[#2b2020] hover:bg-[#f0c27b]">{playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}</button></div><p className="mt-8 max-w-[500px] font-serif text-[20px] italic leading-relaxed text-[#cdbbb0]">“Some journeys begin long before the first step. They begin in the quiet decision not to turn around.”</p></div> : <><div className="mb-8 flex items-center justify-between"><div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#a28d7f]"><BookOpen size={14} /> Part II · The Unmapped Coast <ChevronRight size={13} /></div><div className="text-[11px] font-medium text-[#a28d7f]">p. 84 <span className="mx-2 text-[#c8b8a8]">/</span> 192</div></div><div className="mb-4 flex items-end justify-between gap-4"><div><div className="mb-3 font-mono text-[10px] font-bold uppercase tracking-[0.24em] text-[#b07b5e]">Chapter {activeChapter.no}</div><h1 className="font-serif text-[44px] leading-[0.98] tracking-[-0.035em] sm:text-[62px]">The Letter<br className="sm:hidden" /> in the Wall</h1></div><div className="hidden items-center gap-2 sm:flex"><button type="button" onClick={startReadAloud} className="flex items-center gap-2 rounded-full border border-[#c5aa93] px-4 py-2.5 text-[11px] font-bold text-[#815b4a] transition hover:bg-[#eadccd]"><Volume2 size={14} /> {readAloud === "preparing" ? "Preparing…" : readAloud === "playing" ? "Stop read aloud" : "Read aloud"}</button><button type="button" onClick={() => changeMode("Create Audio")} className="flex items-center gap-2 rounded-full bg-[#765044] px-4 py-2.5 text-[11px] font-bold text-[#faead7] transition hover:bg-[#654237]"><WandSparkles size={14} /> Create audiobook</button></div></div><div className="mb-9 flex items-center gap-3 text-[11px] text-[#a28d7f]"><span>ELENA VOSS</span><span className="h-1 w-1 rounded-full bg-[#c8a27e]" /><span>21 MIN READ</span><span className="h-1 w-1 rounded-full bg-[#c8a27e]" /><span>46% COMPLETE</span></div><div className={`max-w-[650px] space-y-6 ${fontFamily === "serif" ? "font-serif" : "font-sans"} text-[19px] leading-[1.85] text-[#544541]`} style={{ fontSize: `${fontSize}px`, lineHeight }}><p className="first-letter:float-left first-letter:mr-2 first-letter:mt-1 first-letter:text-6xl first-letter:leading-[0.8] first-letter:text-[#b06e51]">{(readerView === "original" ? originalCopy : retoldCopy)[0]}</p><p>{(readerView === "original" ? originalCopy : retoldCopy)[1]}</p><blockquote className="my-8 border-l-2 border-[#c68a62] pl-6 text-[22px] italic leading-[1.6] text-[#73594c]">“Some journeys begin long before the first step. They begin in the quiet decision not to turn around.”</blockquote><p>{(readerView === "original" ? originalCopy : retoldCopy)[2]}</p><p>{(readerView === "original" ? originalCopy : retoldCopy)[3]}</p></div><div className="mt-12 flex items-center gap-3 border-t border-[#d9c9b8] pt-5 text-[11px] text-[#9d887b]"><span className="rounded-full bg-[#e5d6c6] px-3 py-1.5 font-semibold text-[#856b5a]">quiet tension</span><span>·</span><span>2 min left on this page</span>{readAloud === "playing" && <span className="ml-auto flex items-center gap-1.5 rounded-full bg-[#dcc7b4] px-3 py-1.5 font-semibold text-[#815b4a]"><Volume2 size={12} /> Reading this chapter aloud</span>}</div></>}</div></section>}
      </div>

           <footer className="fixed bottom-0 left-0 right-0 z-30 border-t border-[#4a3e40] bg-[#302b30]/[.98] px-4 py-3 shadow-[0_-10px_35px_rgba(23,18,20,.22)] sm:px-7"><div className="mx-auto flex max-w-[1440px] items-center gap-4"><div className="hidden min-w-[220px] items-center gap-3 sm:flex"><div className="flex h-9 w-9 items-center justify-center rounded bg-[#a96049] font-serif text-[8px] leading-tight text-[#f7dfc4]">THE<br />LETTER</div><div><div className="text-[11px] font-semibold text-[#e3d5ca]">Chapter {activeChapter.no} · {activeChapter.title}</div><div className="mt-0.5 text-[10px] text-[#908582]">{mode === "Listen" ? "Saved audiobook" : mode === "Read" ? readAloud === "preparing" ? "Preparing read aloud…" : readAloud === "playing" ? "Reading original text aloud" : "Read aloud available" : "Create audio"} · {activeChapter.time}</div></div></div><button type="button" aria-label={mode === "Read" ? "Read aloud" : playing ? "Pause audio" : "Play audio"} onClick={() => mode === "Read" ? startReadAloud() : setPlaying(!playing)} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#e4b06a] text-[#28201b] transition hover:scale-105">{mode === "Read" ? <Volume2 size={17} /> : playing ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}</button><div className="flex min-w-0 flex-1 items-center gap-3"><span className="font-mono text-[10px] text-[#aa9992]">{playing || readAloud === "playing" ? "08:17" : "07:42"}</span><input aria-label="audio progress" type="range" min="0" max="100" value={progress} onChange={(e) => setProgress(Number(e.target.value))} className="h-1 min-w-0 flex-1 accent-[#e4b06a]" /><span className="font-mono text-[10px] text-[#aa9992]">21:04</span></div><div className="hidden items-center gap-4 text-[#9c908c] md:flex"><button type="button" aria-label="Queue" className="hover:text-[#ead7c2]"><ListMusic size={17} /></button><span className="text-[10px]">1×</span><button type="button" aria-label="More options" className="hover:text-[#ead7c2]"><MoreHorizontal size={18} /></button></div></div></footer>
    </main>
  );
}