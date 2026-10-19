import React, { useEffect, useRef } from 'react';
import { useIdeStore } from '../store/ide';
import { MonacoEditor } from './editor/MonacoEditor';
import { TabBar } from './editor/TabBar';

interface Props {
  projectPath: string | null;
}

export const EditorArea: React.FC<Props> = ({ projectPath }) => {
  const activePath = useIdeStore((s) => s.activePath);
  const openFiles = useIdeStore((s) => s.openFiles);
  const updateContent = useIdeStore((s) => s.updateContent);
  const containerRef = useRef<HTMLDivElement>(null);

  // Global Cmd/Ctrl+S to save the active file
  useEffect(() => {
    const handler = async (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        const file = openFiles.find((f) => f.path === activePath);
        if (!file || !file.dirty) return;
        await window.guang.fs.writeFile(file.path, file.content);
        useIdeStore.getState().markSaved(file.path);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [activePath, openFiles]);

  if (!projectPath) {
    return (
      <div className="editor-empty">
        <div className="editor-empty-title">No folder opened</div>
        <div className="editor-empty-hint">Pick a project folder to start editing.</div>
      </div>
    );
  }

  return (
    <div className="editor-area" ref={containerRef}>
      <TabBar />
      <div className="editor-content">
        {openFiles.length === 0 && (
          <div className="editor-empty">
            <div className="editor-empty-title">No file open</div>
            <div className="editor-empty-hint">Click a file in the explorer to open it.</div>
          </div>
        )}
        {openFiles.map((f) => (
          <div
            key={f.path}
            className={'editor-pane' + (f.path === activePath ? ' active' : '')}
            style={{ display: f.path === activePath ? 'block' : 'none' }}
          >
            <MonacoEditor
              path={f.path}
              language={f.language}
              value={f.content}
              onChange={(v) => updateContent(f.path, v)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};
