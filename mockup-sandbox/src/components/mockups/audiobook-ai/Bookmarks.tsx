import { useMemo, useState } from "react";
import {
  ArrowUpRight,
  BookMarked,
  CalendarDays,
  Check,
  ChevronRight,
  Clock3,
  MoreHorizontal,
  RotateCcw,
  Search,
  StickyNote,
  X,
} from "lucide-react";
import { AppLayout, BookCover, ProgressBar } from "./_shared/AppLayout";

type BookmarkItem = {
  id: number;
  chapter: string;
  chapterTitle: string;
  page: string;
  quote: string;
  note: string;
  date: string;
  tone: string;
};

const initialBookmarks: BookmarkItem[] = [
  {
    id: 1,
    chapter: "Chapter 02",
    chapterTitle: "A House of Blue Light",
    page: "p. 42",
    quote: "A map, her father used to say, was not a picture of where you were. It was a promise that somewhere else existed.",
    note: "The line that explains why Mira keeps drawing the coast from memory.",
    date: "Saved 18 May 2024",
    tone: "amber",
  },
  {
    id: 2,
    chapter: "Chapter 03",
    chapterTitle: "The Letter in the Wall",
    page: "p. 84",
    quote: "Some journeys begin long before the first step. They begin in the quiet decision not to turn around.",
    note: "Feels like the hinge of the whole book. Revisit when the story gets loud.",
    date: "Saved 22 May 2024",
    tone: "rose",
  },
  {
    id: 3,
    chapter: "Chapter 04",
    chapterTitle: "What the River Keeps",
    page: "p. 109",
    quote: "By morning, the river had carried the names away, but not the shape of the hand that wrote them.",
    note: "A beautiful little image for memory: the mark disappears, the gesture remains.",
    date: "Saved 29 May 2024",
    tone: "sage",
  },
];

function BookmarkCard({
  item,
  onRemove,
  onRevisit,
}: {
  item: BookmarkItem;
  onRemove: (id: number) => void;
  onRevisit: (item: BookmarkItem) => void;
}) {
  return (
    <article className="group relative rounded-2xl border border-[#d9c8b7] bg-[#f6eee4] p-5 shadow-[0_10px_30px_rgba(86,57,43,.06)] transition hover:-translate-y-0.5 hover:border-[#c9a988] sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#a06f58]">
          <span className={`h-2 w-2 rounded-full ${item.tone === "amber" ? "bg-[#d59c5b]" : item.tone === "rose" ? "bg-[#b9786a]" : "bg-[#7f9b80]"}`} />
          {item.chapter}
          <ChevronRight size={12} className="text-[#b99d8a]" />
          <span className="normal-case tracking-normal text-[#89756a]">{item.chapterTitle}</span>
        </div>
        <button type="button" aria-label={`More actions for ${item.chapterTitle}`} className="rounded-lg p-1.5 text-[#a18e83] opacity-60 transition hover:bg-[#eadbca] hover:text-[#77594d] group-hover:opacity-100">
          <MoreHorizontal size={17} />
        </button>
      </div>
      <blockquote className="mt-5 max-w-[720px] font-serif text-[21px] leading-[1.48] tracking-[-0.01em] text-[#4c3c38]">
        “{item.quote}”
      </blockquote>
      <div className="mt-5 flex items-start gap-2 border-l-2 border-[#d6a268] pl-3 text-[12px] leading-relaxed text-[#806e65]">
        <StickyNote size={14} className="mt-0.5 shrink-0 text-[#b47d5a]" />
        <span>{item.note}</span>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-[#e4d5c7] pt-4">
        <div className="flex items-center gap-3 text-[10px] text-[#a18d81]">
          <span>{item.date}</span>
          <span className="h-1 w-1 rounded-full bg-[#c8aa91]" />
          <span>{item.page}</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={() => onRemove(item.id)} className="rounded-lg px-3 py-2 text-[10px] font-semibold text-[#9b756c] transition hover:bg-[#f0ddd5] hover:text-[#824f4b]">
            Remove
          </button>
          <button type="button" onClick={() => onRevisit(item)} className="flex items-center gap-1.5 rounded-lg bg-[#3d3033] px-3.5 py-2 text-[10px] font-bold text-[#f3d5ad] transition hover:bg-[#594145]">
            Revisit <ArrowUpRight size={13} />
          </button>
        </div>
      </div>
    </article>
  );
}

export function Bookmarks() {
  const [bookmarks, setBookmarks] = useState(initialBookmarks);
  const [query, setQuery] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const [message, setMessage] = useState("");
  const visibleBookmarks = useMemo(() => bookmarks.filter((item) => `${item.chapter} ${item.chapterTitle} ${item.quote} ${item.note}`.toLowerCase().includes(query.toLowerCase())), [bookmarks, query]);

  const revisit = (item: BookmarkItem) => {
    setMessage(`Opening ${item.chapterTitle} · ${item.page}`);
    window.setTimeout(() => setMessage(""), 2600);
  };

  return (
    <AppLayout active="Bookmarks" eyebrow="The Cartographer’s Daughter" title="Bookmarks" subtitle="Small places to return to — a line, a feeling, a thought worth carrying with you.">
      <div className="mb-7 flex flex-col justify-between gap-4 rounded-2xl border border-[#4a3a3d] bg-[#32292e] p-4 sm:flex-row sm:items-center sm:p-5">
        <div className="flex items-center gap-4">
          <BookCover />
          <div>
            <div className="text-[13px] font-semibold text-[#ead7c2]">The Cartographer’s Daughter</div>
            <div className="mt-1 text-[11px] text-[#9d8b86]">Elena Voss <span className="mx-1.5 text-[#615054]">·</span> 3 saved passages</div>
            <div className="mt-3 flex items-center gap-3"><div className="w-28"><ProgressBar value={46} /></div><span className="text-[10px] text-[#b49c91]">46% read</span></div>
          </div>
        </div>
        <button type="button" onClick={() => setShowEmpty(!showEmpty)} className="self-start rounded-full border border-[#655055] px-3.5 py-2 text-[10px] font-semibold text-[#c5a99b] transition hover:border-[#d09a63] hover:text-[#f0d2a9] sm:self-center">
          {showEmpty ? "Show saved passages" : "Preview an empty book"}
        </button>
      </div>

      {!showEmpty && (
        <div className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-[11px] text-[#a7958d]"><BookMarked size={15} className="text-[#d19a61]" /> {bookmarks.length} passages saved across 3 chapters</div>
          <label className="flex items-center gap-2 rounded-xl border border-[#d6c4b4] bg-[#eee3d6] px-3 py-2 text-[#8b776d]">
            <Search size={14} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a bookmark" className="w-36 bg-transparent text-[11px] text-[#5c4942] outline-none placeholder:text-[#aa9689]" />
            {query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={13} /></button>}
          </label>
        </div>
      )}

      {showEmpty ? (
        <div className="flex min-h-[380px] flex-col items-center justify-center rounded-2xl border border-dashed border-[#cbb7a6] bg-[#eee3d6] px-6 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full border border-[#d7b88d] bg-[#f6eee4] text-[#b77e59]"><BookMarked size={22} /></div>
          <h2 className="mt-5 font-serif text-[30px] text-[#58433d]">Nothing held here yet.</h2>
          <p className="mt-2 max-w-[330px] text-[12px] leading-relaxed text-[#907c71]">When a passage stays with you, tap the bookmark while reading. It will wait here, quietly, until you need it again.</p>
          <button type="button" onClick={() => setShowEmpty(false)} className="mt-6 flex items-center gap-2 rounded-xl bg-[#453438] px-4 py-2.5 text-[11px] font-bold text-[#f1d2aa] hover:bg-[#594145]"><RotateCcw size={14} /> Return to this book</button>
        </div>
      ) : visibleBookmarks.length ? (
        <div className="space-y-4">{visibleBookmarks.map((item) => <BookmarkCard key={item.id} item={item} onRemove={(id) => { setBookmarks((current) => current.filter((bookmark) => bookmark.id !== id)); setMessage("Bookmark removed"); window.setTimeout(() => setMessage(""), 2200); }} onRevisit={revisit} />)}</div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[#cbb7a6] bg-[#eee3d6] p-12 text-center text-[12px] text-[#907c71]">No saved passages match “{query}”.</div>
      )}

      <div className="mt-7 flex items-center gap-2 text-[10px] uppercase tracking-[0.16em] text-[#8f7d76]"><CalendarDays size={13} /> Your reading keeps its place <span className="mx-1 text-[#b69b89]">·</span> <Clock3 size={13} /> Last saved 29 May</div>
      {message && <div className="fixed bottom-6 right-6 z-40 flex items-center gap-2 rounded-xl border border-[#6c5551] bg-[#3b2d31] px-4 py-3 text-[11px] font-semibold text-[#f0d2ab] shadow-2xl"><Check size={14} /> {message}</div>}
    </AppLayout>
  );
}