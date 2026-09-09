import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock3,
  Gauge,
  KeyRound,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from "lucide-react";
import { AppLayout, ProgressBar } from "./_shared/AppLayout";

const lanes = [
  { name: "Lane A · llama-3.3-70b", state: "Healthy", tpm: 72, daily: "41k / 100k", tone: "green" },
  { name: "Lane B · llama-3.3-70b", state: "Healthy", tpm: 54, daily: "28k / 100k", tone: "green" },
  { name: "Lane C · llama-3.3-70b", state: "Cooling", tpm: 18, daily: "19k / 100k", tone: "amber" },
  { name: "Lane D · llama-3.3-70b", state: "Healthy", tpm: 66, daily: "16k / 100k", tone: "green" },
  { name: "Lane E · llama-3.3-70b", state: "Dead", tpm: 0, daily: "0 / 100k", tone: "red" },
];

export function Settings() {
  const [rate, setRate] = useState(0);
  const [pitch, setPitch] = useState(0);
  const [volume, setVolume] = useState(82);
  const [saved, setSaved] = useState(false);

  return (
    <AppLayout
      active="Settings"
      eyebrow="Audiobook AI · engine controls"
      title="Make the system legible."
      subtitle="The controls behind your reading room: voices, quota lanes, honest estimates, and the safety rails that protect your scripts."
    >
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.4fr)_minmax(300px,.8fr)]">
        <section className="rounded-2xl border border-[#4b3b40] bg-[#30272d] p-5 shadow-[0_18px_45px_rgba(18,12,15,.14)] sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#493a3f] pb-5">
            <div>
              <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-[#c3946c]">
                <KeyRound size={14} /> Key pool
              </div>
              <h2 className="mt-2 font-serif text-[29px] text-[#f0decc]">Quota lanes</h2>
              <p className="mt-1 max-w-[470px] text-[11px] leading-relaxed text-[#9e8c87]">
                Independent organisations multiply throughput. A cooling lane pauses without stopping other chapters.
              </p>
            </div>
            <span className="flex items-center gap-2 rounded-full border border-[#4f6653] bg-[#334139] px-3 py-1.5 text-[9px] font-bold uppercase tracking-[0.13em] text-[#a9c6a8]">
              <span className="h-1.5 w-1.5 rounded-full bg-[#8db092]" /> 4 / 5 healthy
            </span>
          </div>

          <div className="mt-5 space-y-2">
            {lanes.map((lane) => (
              <div key={lane.name} className="rounded-xl border border-[#47383c] bg-[#352c31] px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2 text-[11px] font-semibold text-[#dccbc0]">
                    {lane.state === "Dead" ? <AlertTriangle size={14} className="text-[#c57d6b]" /> : <Check size={14} className={lane.state === "Cooling" ? "text-[#d4a36b]" : "text-[#8eae92]"} />}
                    {lane.name}
                  </div>
                  <span className={`text-[9px] font-bold uppercase tracking-[0.14em] ${lane.state === "Dead" ? "text-[#c57d6b]" : lane.state === "Cooling" ? "text-[#d4a36b]" : "text-[#8eae92]"}`}>{lane.state}</span>
                </div>
                <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_110px]">
                  <div>
                    <div className="mb-1 flex justify-between text-[9px] uppercase tracking-[0.13em] text-[#877879]"><span>TPM available</span><span>{lane.tpm}%</span></div>
                    <ProgressBar value={lane.tpm} tone={lane.tone === "green" ? "green" : "gold"} />
                  </div>
                  <div className="text-right text-[10px] text-[#9d8b86]"><div className="text-[9px] uppercase tracking-[0.13em] text-[#827276]">Daily tokens</div><div className="mt-1 font-mono text-[#d1ae84]">{lane.daily}</div></div>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-5 flex items-start gap-3 rounded-xl border border-[#5b4844] bg-[#3b302f] p-4 text-[10px] leading-relaxed text-[#ad9890]">
            <ShieldCheck size={15} className="mt-0.5 shrink-0 text-[#8eac91]" />
            <span><strong className="text-[#d7c1ae]">Failure isolation is on.</strong> One chunk can rotate lanes, one chapter can fail without killing the batch, and a stopped job keeps its completed chapters.</span>
          </div>
        </section>

        <aside className="space-y-5">
          <section className="rounded-2xl border border-[#d6c4b2] bg-[#eee3d6] p-5 text-[#503d38] shadow-[0_18px_45px_rgba(18,12,15,.12)]">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#9b7563]"><SlidersHorizontal size={14} /> Voice profile</div>
            <h2 className="mt-3 font-serif text-[27px] text-[#624940]">Ananya · warm, close</h2>
            <p className="mt-2 text-[11px] leading-relaxed text-[#8b756b]">These prosody values are saved onto the audiobook job.</p>
            <div className="mt-5 space-y-4 border-t border-[#d8c6b5] pt-5">
              <label className="flex items-center gap-3 text-[10px] text-[#806a60]"><span className="w-14">Rate</span><input aria-label="Default speaking rate" type="range" min="-20" max="20" value={rate} onChange={(event) => setRate(Number(event.target.value))} className="flex-1 accent-[#9b684e]" /><span className="w-8 text-right font-mono text-[#9b684e]">{rate > 0 ? "+" : ""}{rate}%</span></label>
              <label className="flex items-center gap-3 text-[10px] text-[#806a60]"><span className="w-14">Pitch</span><input aria-label="Default voice pitch" type="range" min="-10" max="10" value={pitch} onChange={(event) => setPitch(Number(event.target.value))} className="flex-1 accent-[#9b684e]" /><span className="w-8 text-right font-mono text-[#9b684e]">{pitch > 0 ? "+" : ""}{pitch}</span></label>
              <label className="flex items-center gap-3 text-[10px] text-[#806a60]"><span className="w-14">Volume</span><input aria-label="Default voice volume" type="range" min="0" max="100" value={volume} onChange={(event) => setVolume(Number(event.target.value))} className="flex-1 accent-[#9b684e]" /><span className="w-8 text-right font-mono text-[#9b684e]">{volume}%</span></label>
            </div>
            <button type="button" onClick={() => setSaved(true)} className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl bg-[#765044] px-4 py-3 text-[11px] font-bold text-[#faead7] transition hover:bg-[#654237]">{saved ? <Check size={14} /> : <Gauge size={14} />} {saved ? "Profile saved" : "Save voice profile"}</button>
          </section>

          <section className="rounded-2xl border border-[#4b3b40] bg-[#30272d] p-5">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-[#b48e6c]"><Sparkles size={14} /> Quality policy</div>
            <div className="mt-4 space-y-3 text-[11px] text-[#ac9a93]">
              <div className="flex items-center justify-between border-b border-[#493a3f] pb-3"><span>Retelling target</span><strong className="text-[#d9b486]">~450 words / chunk</strong></div>
               <div className="flex items-center justify-between border-b border-[#493a3f] pb-3"><span>Output script</span><strong className="text-[#d9b486]">Devanagari / mixed</strong></div>
              <div className="flex items-center justify-between"><span>Dialogue handling</span><strong className="text-[#8eae92]">Keep as speech</strong></div>
            </div>
            <button type="button" className="mt-5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.14em] text-[#d2a16f] hover:text-[#efc184]">View engine notes <ChevronRight size={13} /></button>
          </section>
        </aside>
      </div>

       <div className="mt-6 flex items-center gap-2 text-[10px] text-[#857578]"><Clock3 size={13} /> Estimates use measured chapter cost, current daily quota, and healthy key lanes — not a single optimistic number.</div>
    </AppLayout>
  );
}