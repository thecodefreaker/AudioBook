import { type ReactNode } from "react";
import { Check, CircleAlert, LoaderCircle } from "lucide-react";

export const panel = "rounded-2xl border border-[#4c3c42] bg-[#30272d] shadow-[0_18px_45px_rgba(18,12,15,.12)]";
export const muted = "text-[#9f8d89]";

export function StatusPill({ state }: { state: "Healthy" | "Cooling" | "Dead" | "Disabled" | "Ready" | "Running" | "Saved" }) {
  const styles = {
    Healthy: "border-[#4f6653] bg-[#334139] text-[#a9c6a8]",
    Ready: "border-[#4f6653] bg-[#334139] text-[#a9c6a8]",
    Saved: "border-[#4f6653] bg-[#334139] text-[#a9c6a8]",
    Cooling: "border-[#665540] bg-[#40362e] text-[#d8b07b]",
    Running: "border-[#665540] bg-[#40362e] text-[#e3bb86]",
    Dead: "border-[#704942] bg-[#442f32] text-[#d58d7b]",
    Disabled: "border-[#51464a] bg-[#373034] text-[#9c8f8d]",
  }[state];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.13em] ${styles}`}><span className={`h-1.5 w-1.5 rounded-full ${state === "Healthy" || state === "Ready" || state === "Saved" ? "bg-[#8db092]" : state === "Dead" ? "bg-[#c57d6b]" : "bg-[#d4a36b]"}`} />{state}</span>;
}

export function Metric({ label, value, detail, icon }: { label: string; value: string; detail: string; icon?: ReactNode }) {
  return <div className="rounded-xl border border-[#493a40] bg-[#352c31] p-4"><div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-[.16em] text-[#94817d]"><span>{label}</span>{icon}</div><div className="mt-2 font-serif text-[28px] leading-none text-[#f0d9c1]">{value}</div><div className="mt-2 text-[10px] text-[#a18e89]">{detail}</div></div>;
}

export function TinyBar({ value, tone = "gold" }: { value: number; tone?: "gold" | "green" | "red" }) {
  return <div className="h-1.5 overflow-hidden rounded-full bg-[#4e3d40]"><div className={`h-full rounded-full ${tone === "green" ? "bg-[#7ea286]" : tone === "red" ? "bg-[#bd7668]" : "bg-[#d89c61]"}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

export function SaveButton({ saved, onClick, children = "Save changes" }: { saved: boolean; onClick: () => void; children?: ReactNode }) {
  return <button type="button" onClick={onClick} className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#765044] px-4 py-3 text-[11px] font-bold text-[#faead7] transition hover:-translate-y-0.5 hover:bg-[#8a5a49]">{saved ? <Check size={14} /> : null}{saved ? "Saved just now" : children}</button>;
}

export function LoadingMark({ active = true }: { active?: boolean }) {
  return active ? <LoaderCircle size={14} className="animate-spin text-[#d6a36d]" /> : <CircleAlert size={14} className="text-[#c57d6b]" />;
}