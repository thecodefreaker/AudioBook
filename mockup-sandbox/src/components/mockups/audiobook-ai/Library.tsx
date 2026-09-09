import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronDown,
  Clock3,
  Headphones,
  LayoutGrid,
  List,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { AppLayout, BookCover, ProgressBar } from "./_shared/AppLayout";

type Book = {
  title: string;
  author: string;
  cover: string;
  read: number;
  audio: number;
  audioLabel: string;
  chapter: string;
  updated: string;
  status: "Reading" | "Finished" | "Queued";
  tone?: "green";
};

const books: Book[] = [
  { title: "The Cartographer's Daughter", author: "Elena Voss", cover: "THE\nCARTOGRAPHER", read: 46, audio: 50, audioLabel: "6 of 12 chapters", chapter: "Chapter 03 · The Letter in the Wall", updated: "Updated 18 min ago", status: "Reading" },
  { title: "A Field Guide to Leaving", author: "Mara Bell", cover: "A FIELD\nGUIDE", read: 72, audio: 68, audioLabel: "9 of 14 chapters", chapter: "Chapter 09 · The Long Way Home", updated: "Updated yesterday", status: "Reading" },
  { title: "Salt on the Windowsill", author: "Ishaan Mehta", cover: "SALT ON THE\nWINDOWSILL", read: 100, audio: 100, audioLabel: "Complete audiobook", chapter: "Finished · 6 hr 18 min", updated: "Finished 3 days ago", status: "Finished", tone: "green" },
  { title: "The Orchard at Dusk", author: "Nadia Rowan", cover: "THE ORCHARD\nAT DUSK", read: 18, audio: 0, audioLabel: "Not started", chapter: "Chapter 02 · First Frost", updated: "Added 5 days ago", status: "Reading" },
  { title: "Letters from the Monsoon", author: "Devika Sen", cover: "LETTERS FROM\nTHE MONSOON", read: 0, audio: 0, audioLabel: "Not started", chapter: "Chapter 01 · The Blue Tin", updated: "Added 1 week ago", status: "Queued" },
  { title: "Small Hours, Wide Sea", author: "Jonah Adebayo", cover: "SMALL HOURS,\nWIDE SEA", read: 64, audio: 54, audioLabel: "7 of 13 chapters", chapter: "Chapter 07 · Soundings", updated: "Updated 2 weeks ago", status: "Reading" },
];

function BookRow({ book, onOpen }: { book: Book; onOpen: (book: Book) => void }) {
  return (
    <article className="group flex min-w-0 items-center gap-4 border-b border-[#41363a] py-4 first:pt-1 last:border-0 sm:gap-5">
      <BookCover label={book.cover} />
      <div className="min-w-0 flex-1 self-stretch py-1">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-serif text-[20px] tracking-[-0.02em] text-[#efdecc]">{book.title}</h3>
            <p className="mt-1 text-[11px] text-[#a3948e]">{book.author} <span className="mx-1.5 text-[#66565a]">·</span> {book.status}</p>
          </div>
          <button type="button" onClick={() => onOpen(book)} aria-label={`Open ${book.title}`} className="rounded-full border border-[#5a4847] p-2 text-[#c99a6f] opacity-0 transition group-hover:opacity-100 hover:bg-[#49383c]">
            <ArrowUpRight size={15} />
          </button>
        </div>
        <p className="mt-3 truncate text-[11px] text-[#8f817d]">{book.chapter}</p>
        <div className="mt-3 grid max-w-[520px] grid-cols-[1fr_1fr] gap-5">
          <div>
            <div className="mb-1.5 flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.14em] text-[#9f8e87]"><span>Reading</span><span className="font-mono text-[#d4ad81]">{book.read}%</span></div>
            <ProgressBar value={book.read} tone={book.tone ? "green" : "gold"} />
          </div>
          <div>
             <div className="mb-1.5 flex items-center justify-between text-[9px] font-bold uppercase tracking-[0.14em] text-[#9f8e87]"><span>Audiobook</span><span className="font-mono text-[#b6a7a0]">{book.audioLabel}</span></div>
            <ProgressBar value={book.audio} tone={book.tone ? "green" : "gold"} />
          </div>
        </div>
      </div>
      <div className="hidden w-[105px] shrink-0 text-right text-[10px] leading-relaxed text-[#817474] lg:block">{book.updated}</div>
    </article>
  );
}

export function Library() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"All books" | "In progress" | "Finished">("All books");
  const [view, setView] = useState<"list" | "grid">("list");
  const [showImport, setShowImport] = useState(false);
  const [notice, setNotice] = useState("");

  const visibleBooks = useMemo(() => books.filter((book) => {
    const matchesQuery = `${book.title} ${book.author}`.toLowerCase().includes(query.toLowerCase());
    const matchesFilter = filter === "All books" || (filter === "Finished" ? book.status === "Finished" : book.status === "Reading");
    return matchesQuery && matchesFilter;
  }), [filter, query]);

  const openBook = (book: Book) => {
    setNotice(`Opening ${book.title}`);
    window.setTimeout(() => setNotice(""), 2200);
  };

  return (
    <AppLayout active="Library" eyebrow="Your collection" title="A shelf for every kind of story." subtitle="Pick up where you left off, or find a quieter corner of the room. Reading, listening, and saved audiobook progress stay separate here.">
      <div className="relative">
        {notice && <div className="fixed right-6 top-20 z-30 flex items-center gap-2 rounded-xl border border-[#6c513f] bg-[#3a2d31] px-4 py-3 text-[11px] text-[#eed6bb] shadow-2xl"><Check size={14} className="text-[#dca76d]" /> {notice}</div>}
        <section className="mb-7 flex flex-col justify-between gap-5 rounded-2xl border border-[#4a3b3d] bg-[#31282d] p-5 sm:flex-row sm:items-center sm:p-6">
          <div className="flex items-start gap-4">
            <div className="mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#453237] text-[#e3ad73]"><Sparkles size={18} /></div>
             <div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#bc916a]">Your reading room</p><p className="mt-2 max-w-[480px] font-serif text-[19px] leading-tight text-[#e9d7c5]">Read first. Create audio when you are ready.</p><p className="mt-1.5 text-[11px] text-[#988985]">Original EPUB text stays available before any retelling begins.</p></div>
          </div>
          <button type="button" onClick={() => setShowImport(true)} className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-[#e4b06a] px-4 py-3 text-[11px] font-bold text-[#2b2020] transition hover:-translate-y-0.5 hover:bg-[#f0c27b]"><Plus size={15} /> Add a book</button>
        </section>

        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-1 rounded-xl bg-[#31292e] p-1">
            {(["All books", "In progress", "Finished"] as const).map((item) => <button type="button" key={item} onClick={() => setFilter(item)} className={`rounded-lg px-3 py-2 text-[10px] font-bold transition ${filter === item ? "bg-[#4b383c] text-[#f0d2af]" : "text-[#978986] hover:text-[#dfc9b8]"}`}>{item}</button>)}
          </div>
          <div className="flex gap-2">
            <label className="flex min-w-0 flex-1 items-center gap-2 rounded-xl border border-[#4c3c40] bg-[#30272c] px-3 text-[#a59590] sm:w-[220px] sm:flex-none"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your shelf" className="min-w-0 flex-1 bg-transparent py-2.5 text-[11px] text-[#ead9ca] outline-none placeholder:text-[#7d7070]" /></label>
            <button type="button" aria-label="Filter books" onClick={() => setFilter(filter === "All books" ? "In progress" : "All books")} className="rounded-xl border border-[#4c3c40] px-3 text-[#a59590] hover:bg-[#3b3035]"><SlidersHorizontal size={15} /></button>
            <div className="hidden rounded-xl border border-[#4c3c40] p-1 sm:flex"><button type="button" aria-label="List view" onClick={() => setView("list")} className={`rounded-lg p-1.5 ${view === "list" ? "bg-[#4b383c] text-[#e6bc8a]" : "text-[#887a78]"}`}><List size={15} /></button><button type="button" aria-label="Grid view" onClick={() => setView("grid")} className={`rounded-lg p-1.5 ${view === "grid" ? "bg-[#4b383c] text-[#e6bc8a]" : "text-[#887a78]"}`}><LayoutGrid size={15} /></button></div>
          </div>
        </div>

        <div className="mb-3 flex items-center justify-between px-1"><p className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#897976]">{visibleBooks.length} books <span className="mx-1.5 text-[#5b4b4e]">·</span> {filter.toLowerCase()}</p><p className="hidden items-center gap-1.5 text-[10px] text-[#817477] sm:flex"><Clock3 size={12} /> Last opened recently</p></div>
        {visibleBooks.length > 0 ? <div className={view === "grid" ? "grid gap-x-6 gap-y-3 sm:grid-cols-2" : "rounded-xl border border-[#41363a] bg-[#2d262b] px-4 sm:px-5"}>{visibleBooks.map((book) => <BookRow key={book.title} book={book} onOpen={openBook} />)}</div> : <div className="rounded-2xl border border-dashed border-[#59464a] bg-[#30272c] px-6 py-16 text-center"><BookOpen size={22} className="mx-auto text-[#b08361]" /><p className="mt-4 font-serif text-[22px] text-[#e5d0bd]">No stories found.</p><p className="mt-2 text-[11px] text-[#968781]">Try another title, author, or shelf.</p></div>}

         <div className="mt-6 flex items-center justify-between border-t border-[#3c3236] px-1 pt-5 text-[10px] text-[#817477]"><span><Headphones size={13} className="mr-1.5 inline text-[#b48361]" /> Reading, listening, and audiobook progress stay separate.</span><button type="button" onClick={() => setShowImport(true)} className="flex items-center gap-1.5 font-bold text-[#c6976d] hover:text-[#edc08f]"><Upload size={13} /> Import EPUB</button></div>
      </div>

       {showImport && <div className="fixed inset-0 z-40 flex items-center justify-center bg-[#181417]/70 p-5 backdrop-blur-sm"><div className="w-full max-w-[430px] rounded-2xl border border-[#5a4546] bg-[#342a2f] p-6 shadow-2xl"><div className="flex items-start justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#bd916c]">Add to your room</p><h2 className="mt-2 font-serif text-[30px] text-[#f0ddca]">Bring in an EPUB.</h2></div><button type="button" aria-label="Close import dialog" onClick={() => setShowImport(false)} className="rounded-lg p-1 text-[#a2908b] hover:bg-[#49383d]"><X size={17} /></button></div><div className="mt-6 rounded-xl border border-dashed border-[#72564c] bg-[#3b2d32] p-8 text-center"><Upload size={22} className="mx-auto text-[#d19b69]" /><p className="mt-3 text-[12px] font-semibold text-[#e4cdb9]">Drop an EPUB here</p><p className="mt-1 text-[10px] text-[#988782]">We’ll detect the book and extract its chapters.</p><button type="button" onClick={() => { setShowImport(false); setNotice("EPUB ready for chapter extraction"); }} className="mt-5 rounded-lg border border-[#705345] px-4 py-2 text-[10px] font-bold text-[#e5bd91] hover:bg-[#4a3739]">Choose EPUB</button></div><p className="mt-4 flex items-center gap-2 text-[10px] leading-relaxed text-[#95847f]"><BookOpen size={13} /> Reading is available immediately — audiobook creation is always optional.</p></div></div>}
    </AppLayout>
  );
}