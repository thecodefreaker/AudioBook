import { useCallback, useEffect, useState } from "react";

export const PRODUCT_STATE_KEY = "audiobook-ai-demo-state";

export type GenerationStage = "Prepare" | "Retell" | "Narrate" | "Stitch" | "Index";
export type GenerationStatus = "queued" | "running" | "paused" | "failed" | "complete";

export type ProductState = {
  selectedBookId: string;
  bookTitle: string;
  author: string;
  totalChapters: number;
  selectedChapterId: string;
  selectedChapterNumber: string;
  chapterTitle: string;
  chapterDuration: string;
  readingProgress: number;
  listeningProgress: number;
  audiobookReadyCount: number;
  audiobookReadyTotal: number;
  selectedScriptRevisionId: string;
  selectedScriptRevisionLabel: string;
  selectedAudioVersionId: string;
  selectedAudioVersionLabel: string;
  generationJobId: string;
  generationStage: GenerationStage;
  generationStageNumber: number;
  generationProgress: number;
  generationStatus: GenerationStatus;
  language: string;
  voice: string;
  lastUpdatedAt: string;
  activityLabel: string;
};

const seedState: ProductState = {
  selectedBookId: "book-mvs",
  bookTitle: "My Vampire System",
  author: "Jupiter Studios",
  totalChapters: 12,
  selectedChapterId: "chapter-03",
  selectedChapterNumber: "03",
  chapterTitle: "The Letter in the Wall",
  chapterDuration: "21 min",
  readingProgress: 46,
  listeningProgress: 31,
  audiobookReadyCount: 6,
  audiobookReadyTotal: 12,
  selectedScriptRevisionId: "scr_ai_v4",
  selectedScriptRevisionLabel: "AI Script V4",
  selectedAudioVersionId: "aud_v3_8f2",
  selectedAudioVersionLabel: "Audio V3",
  generationJobId: "job_ch03_2025_03",
  generationStage: "Narrate",
  generationStageNumber: 3,
  generationProgress: 68,
  generationStatus: "running",
  language: "Hindi · Hinglish",
  voice: "Ananya · warm, close",
  lastUpdatedAt: "2026-08-13T18:42:00.000Z",
  activityLabel: "Chapter 03 narration is being shaped",
};

function isProductState(value: unknown): value is ProductState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ProductState>;
  return (
    typeof candidate.selectedBookId === "string" &&
    typeof candidate.selectedChapterId === "string" &&
    typeof candidate.chapterTitle === "string" &&
    typeof candidate.readingProgress === "number" &&
    typeof candidate.listeningProgress === "number" &&
    typeof candidate.audiobookReadyCount === "number" &&
    typeof candidate.selectedScriptRevisionId === "string" &&
    typeof candidate.selectedAudioVersionId === "string" &&
    typeof candidate.generationStage === "string" &&
    typeof candidate.generationStatus === "string" &&
    typeof candidate.language === "string" &&
    typeof candidate.voice === "string"
  );
}

export function readProductState(): ProductState {
  if (typeof window === "undefined") return seedState;
  try {
    const stored = window.localStorage.getItem(PRODUCT_STATE_KEY);
    if (!stored) return seedState;
    const parsed: unknown = JSON.parse(stored);
    return isProductState(parsed) ? { ...seedState, ...parsed } : seedState;
  } catch {
    return seedState;
  }
}

export function updateProductState(patch: Partial<ProductState>): ProductState {
  const next = {
    ...readProductState(),
    ...patch,
    lastUpdatedAt: new Date().toISOString(),
  };
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PRODUCT_STATE_KEY, JSON.stringify(next));
  }
  return next;
}

export function resetProductState(): ProductState {
  if (typeof window !== "undefined") {
    window.localStorage.setItem(PRODUCT_STATE_KEY, JSON.stringify(seedState));
  }
  return seedState;
}

export function useProductState(): [ProductState, (patch: Partial<ProductState>) => void] {
  const [state, setState] = useState<ProductState>(readProductState);

  useEffect(() => {
    const handleStorage = (event: StorageEvent) => {
      if (event.key === PRODUCT_STATE_KEY && event.newValue) {
        try {
          const parsed: unknown = JSON.parse(event.newValue);
          if (isProductState(parsed)) setState({ ...seedState, ...parsed });
        } catch {
          setState(readProductState());
        }
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  const update = useCallback((patch: Partial<ProductState>) => {
    setState(updateProductState(patch));
  }, []);

  return [state, update];
}

export function useProductActivity(): string {
  const [state] = useProductState();
  return state.activityLabel;
}

export function percentLabel(value: number): string {
  return `${Math.round(value)}%`;
}