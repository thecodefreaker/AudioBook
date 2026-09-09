import { useState } from "react";
import {
  Archive,
  Check,
  ChevronDown,
  Clock3,
  Feather,
  MoreHorizontal,
  Plus,
  Search,
  Tag,
  Trash2,
} from "lucide-react";
import { AppLayout, BookCover, ProgressBar } from "./_shared/AppLayout";

type Note = {
  id: number;
  chapter: string;
  title: string;
  preview: string;
  updated: string;
  tags: string[];
};

const initialNotes: Note[] = [
  {
    id: 1,
    chapter: "Chapter 03 · The Letter in the Wall",
    title: "A map is never only a map",
    preview: "Her father's lines are less an instruction than a way of asking her to trust...",
    updated: "Edited 8 min ago",
    tags: ["inheritance", "quiet tension"],
  },
  {
    id: 2,
    chapter: "Chapter 02 · A House of Blue Light",
    title: "The blue room",
    preview: "The house seems to remember Mira before she has had the chance to remember it.",
    updated: "Yesterday",
    tags: ["setting"],
  },
  {
    id: 3,
    chapter: "Chapter 01 · The Night Train",
    title: "Six words in the envelope",
    preview: "You will know when you arrive. A promise that feels almost like a dare.",
    updated: "Mar 14",
    tags: ["mira", "foreshadowing"],
  },
  {
    id: 4,
    chapter: "Chapter 04 · What the River Keeps",
    title: "The river as witness",
    preview: "Water keeps the shape of every place it has passed through, even after it moves on.",
    updated: "Mar 11",
    tags: ["image", "memory"],
  },
];

const noteBody = `The map is not giving Mira a destination. It is giving her a vocabulary for the things her father could not say plainly.\n\nI keep thinking about the difference between being lost and being unaccompanied. The first is a problem to solve; the second might be the condition he wanted her to inhabit long enough to become herself.\n\n“Some journeys begin long before the first step.”`;

export function Notes() {
  const [notes, setNotes] = useState(initialNotes);
  const [selectedId, setSelectedId] = useState(1);
  const [title, setTitle] = useState(initialNotes[0].title);
  const [body, setBody] = useState(noteBody);
  const [tags, setTags] = useState(initialNotes[0].tags.join("  ·  "));
  const [saved, setSaved] = useState(true);
  const [query, setQuery] = useState("");
  const [showDetails, setShowDetails] = useState(true);

  const selected = notes.find((note) => note.id === selectedId) ?? notes[0];
  const visibleNotes = notes.filter((note) =>
    `${note.title} ${note.chapter} ${note.preview}`.toLowerCase().includes(query.toLowerCase()),
  );

  const selectNote = (note: Note) => {
    setSelectedId(note.id);
    setTitle(note.title);
    setBody(note.id === 1 ? noteBody : `${note.preview}\n\nI want to return to this passage after finishing the next chapter.`);
    setTags(note.tags.join("  ·  "));
    setSaved(true);
  };

  const saveNote = () => {
    setNotes((current) =>
      current.map((note) =>
        note.id === selectedId
          ? { ...note, title, preview: body.slice(0,  ninety()).trim() + "…", tags: tags.split("·").map((tag) => tag.trim()).filter(Boolean), updated: "Edited just now" }
          : note,
      ),
    );
    setSaved(true);
  };

  const createNote = () => {
    const fresh: Note = {
      id: Date.now(),
      chapter: "Chapter 03 · The Letter in the Wall",
      title: "Untitled note",
      preview: "Begin writing a thought about this chapter…",
      updated: "Not saved yet",
      tags: ["new thought"],
    };
    setNotes((current) => [fresh, ...current]);
    setSelectedId(fresh.id);
    setTitle(fresh.title);
    setBody("");
    setTags(fresh.tags.join("  ·  "));
    setSaved(false);
  };

  return (
    <AppLayout
      active="Notes"
      eyebrow="A private reading journal"
      title="Notes"
      subtitle="Keep the fragments that stay with you. Every note remembers where it began."
    >
      <div className="grid gap-5 xl:grid-cols-[310px_minmax(0,1fr)_198px]">
        <section className="min-h-[548px] rounded-2xl border border-[#4a3b40] bg-[#31292f] shadow-[0_18px_45px_rgba(22,15,19,.14)]">
          <div className="flex items-center justify-between border-b border-[#493a3e] px-4 py-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-[#c1936b]">The Cartographer&apos;s Daughter</div>
              <div className="mt-1 text-[11px] text-[#8f807e]">{notes.length} notes · 4 chapters visited</div>
            </div>
            <button type="button" onClick={createNote} aria-label="Create a new note" className="flex h-8 w-8 items-center justify-center rounded-full bg-[#e4b06a] text-[#30231f] transition hover:scale-105">
              <Plus size={16} />
            </button>
          </div>
          <div className="border-b border-[#493a3e] px-4 py-3">
            <label className="flex items-center gap-2 rounded-lg border border-[#4a3b40] bg-[#292329] px-3 py-2 text-[#978784]">
              <Search size={14} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search your notes" className="min-w-0 flex-1 bg-transparent text-[11px] text-[#dfcfc4] outline-none placeholder:text-[#776c6e]" />
            </label>
          </div>
          <div className="space-y-1 p-2">
            {visibleNotes.map((note) => (
              <button key={note.id} type="button" onClick={() => selectNote(note)} className={`w-full rounded-xl px-3 py-3 text-left transition ${selectedId === note.id ? "bg-[#49363b] shadow-[inset_3px_0_0_#d89c61]" : "hover:bg-[#3a3035]"}`}>
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className={`truncate text-[9px] font-bold uppercase tracking-[0.12em] ${selectedId === note.id ? "text-[#d7a678]" : "text-[#88797a]"}`}>{note.chapter.split(" · ")[0]}</span>
                  <span className="shrink-0 text-[9px] text-[#756a6c]">{note.updated.replace("Edited ", "")}</span>
                </div>
                <div className="font-serif text-[16px] text-[#ead8cb]">{note.title}</div>
                <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-[#9e8f8d]">{note.preview}</p>
              </button>
            ))}
          </div>
          <div className="mt-2 border-t border-[#493a3e] px-4 py-3 text-[10px] text-[#887b7b]">
            <span className="text-[#c4a17e]">Private by default.</span> Your notes stay in your reading room.
          </div>
        </section>

        <section className="min-h-[548px] rounded-2xl border border-[#d6c4b2] bg-[#f1e7db] text-[#4f3d38] shadow-[0_18px_50px_rgba(20,14,14,.12)]">
          <div className="flex items-center justify-between border-b border-[#decfc0] px-6 py-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-[#9a7564]">
              <Feather size={14} /> {selected.chapter}
            </div>
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1.5 text-[10px] text-[#97857e]">{saved ? <Check size={13} className="text-[#769079]" /> : <Clock3 size={13} />} {saved ? "Saved to your journal" : "Unsaved changes"}</span>
              <button type="button" aria-label="More note actions" className="rounded-lg p-1.5 text-[#987f76] hover:bg-[#e6d8c9]"><MoreHorizontal size={17} /></button>
            </div>
          </div>
          <div className="px-6 pb-8 pt-7 sm:px-9">
            <input value={title} onChange={(event) => { setTitle(event.target.value); setSaved(false); }} className="w-full bg-transparent font-serif text-[34px] leading-tight tracking-[-0.03em] text-[#4b3833] outline-none placeholder:text-[#b7a49a]" placeholder="Give this note a title" />
            <div className="mt-4 flex items-center gap-2 text-[10px] text-[#a1897d]"><Tag size={13} /><input value={tags} onChange={(event) => { setTags(event.target.value); setSaved(false); }} className="min-w-0 flex-1 bg-transparent tracking-[0.08em] outline-none" aria-label="Note tags" /></div>
            <textarea value={body} onChange={(event) => { setBody(event.target.value); setSaved(false); }} className="mt-7 min-h-[275px] w-full resize-none bg-transparent font-serif text-[17px] leading-[1.85] text-[#654d44] outline-none placeholder:text-[#b7a49a]" placeholder="What did this chapter leave behind?" />
            <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-[#decfc0] pt-5">
              <div className="text-[10px] text-[#aa9589]">Chapter 03 · p. 84 <span className="mx-2">·</span> {body.length} characters</div>
              <button type="button" onClick={saveNote} className="rounded-lg bg-[#765044] px-4 py-2.5 text-[11px] font-bold text-[#faead7] transition hover:bg-[#654237]">Save note</button>
            </div>
          </div>
        </section>

        <aside className="hidden xl:block">
          <div className="rounded-2xl border border-[#4b3c40] bg-[#30282d] p-4">
            <button type="button" onClick={() => setShowDetails(!showDetails)} className="flex w-full items-center justify-between text-left text-[10px] font-bold uppercase tracking-[0.18em] text-[#bc9675]">
              <span>From this chapter</span><ChevronDown size={14} className={`transition ${showDetails ? "rotate-180" : ""}`} />
            </button>
            {showDetails && <div className="mt-4">
              <div className="flex gap-3"><BookCover /><div><div className="font-serif text-[16px] leading-tight text-[#ead8cb]">The Letter in the Wall</div><div className="mt-1 text-[10px] text-[#978989]">Chapter 03 · 21 min</div></div></div>
              <div className="mt-5 text-[10px] font-bold uppercase tracking-[0.16em] text-[#847578]">Chapter progress</div>
              <div className="mt-2 flex items-center gap-2"><ProgressBar value={46} /><span className="text-[10px] text-[#bf9a76]">46%</span></div>
              <p className="mt-5 border-l border-[#9b694f] pl-3 font-serif text-[14px] italic leading-relaxed text-[#bca9a0]">“You will know when you arrive.”</p>
              <button type="button" className="mt-5 flex items-center gap-2 text-[10px] font-semibold text-[#d0a06f] hover:text-[#e6ba82]"><Archive size={13} /> View chapter highlights</button>
            </div>}
          </div>
          <div className="mt-4 rounded-2xl border border-[#4b3c40] bg-[#30282d] p-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-[#847578]">Notebook ritual</div>
            <p className="mt-3 font-serif text-[17px] leading-relaxed text-[#d1bdb0]">“Write down what the story makes you notice about your own life.”</p>
            <div className="mt-3 text-[10px] text-[#8e7d7e]">A gentle prompt for the next page.</div>
          </div>
        </aside>
      </div>
    </AppLayout>
  );
}

function ninety() {
  return 112;
}