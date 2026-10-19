import { create } from 'zustand';
import { OpenFile, FsEntry } from '@shared/types';

interface IdeState {
  // File system
  tree: FsEntry | null;
  setTree: (t: FsEntry | null) => void;

  // Editor
  openFiles: OpenFile[];
  activePath: string | null;
  openFile: (f: OpenFile) => void;
  closeFile: (path: string) => void;
  setActive: (path: string | null) => void;
  updateContent: (path: string, content: string) => void;
  markSaved: (path: string) => void;

  // Diff tracking (for AI edits)
  pendingDiffs: Map<string, { before: string; after: string }>;
  setPendingDiff: (path: string, before: string, after: string) => void;
  acceptDiff: (path: string) => Promise<void>;
  rejectDiff: (path: string) => void;
}

export const useIdeStore = create<IdeState>((set, get) => ({
  tree: null,
  setTree: (t) => set({ tree: t }),

  openFiles: [],
  activePath: null,
  openFile: (f) => {
    const existing = get().openFiles.find((x) => x.path === f.path);
    if (existing) {
      set({ activePath: f.path });
      return;
    }
    set({ openFiles: [...get().openFiles, f], activePath: f.path });
  },
  closeFile: (path) => {
    const remaining = get().openFiles.filter((x) => x.path !== path);
    const next = get().activePath === path
      ? (remaining.length ? remaining[remaining.length - 1].path : null)
      : get().activePath;
    set({ openFiles: remaining, activePath: next });
  },
  setActive: (path) => set({ activePath: path }),
  updateContent: (path, content) => {
    set({
      openFiles: get().openFiles.map((f) =>
        f.path === path ? { ...f, content, dirty: true } : f
      ),
    });
  },
  markSaved: (path) => {
    set({
      openFiles: get().openFiles.map((f) =>
        f.path === path ? { ...f, dirty: false } : f
      ),
    });
  },

  pendingDiffs: new Map(),
  setPendingDiff: (path, before, after) => {
    const next = new Map(get().pendingDiffs);
    next.set(path, { before, after });
    set({ pendingDiffs: next });
  },
  acceptDiff: async (path) => {
    const diff = get().pendingDiffs.get(path);
    if (!diff) return;
    await window.guang.fs.writeFile(path, diff.after);
    const next = new Map(get().pendingDiffs);
    next.delete(path);
    set({
      pendingDiffs: next,
      openFiles: get().openFiles.map((f) =>
        f.path === path ? { ...f, content: diff.after, dirty: false } : f
      ),
    });
  },
  rejectDiff: (path) => {
    const diff = get().pendingDiffs.get(path);
    if (!diff) return;
    const next = new Map(get().pendingDiffs);
    next.delete(path);
    set({
      pendingDiffs: next,
      openFiles: get().openFiles.map((f) =>
        f.path === path ? { ...f, content: diff.before, dirty: false } : f
      ),
    });
  },
}));
