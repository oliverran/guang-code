import React from 'react';
import { useIdeStore } from '../../store/ide';

export const TabBar: React.FC = () => {
  const files = useIdeStore((s) => s.openFiles);
  const activePath = useIdeStore((s) => s.activePath);
  const setActive = useIdeStore((s) => s.setActive);
  const closeFile = useIdeStore((s) => s.closeFile);
  const pendingDiffs = useIdeStore((s) => s.pendingDiffs);

  if (files.length === 0) return <div className="tabbar tabbar-empty" />;

  return (
    <div className="tabbar">
      {files.map((f) => {
        const baseName = f.relativePath.split('/').pop() ?? f.relativePath;
        const hasPending = pendingDiffs.has(f.path);
        return (
          <div
            key={f.path}
            className={'tab' + (f.path === activePath ? ' active' : '') + (hasPending ? ' has-diff' : '')}
            onClick={() => setActive(f.path)}
            title={f.relativePath}
          >
            <span className="tab-name">{baseName}</span>
            {f.dirty && <span className="tab-dirty">●</span>}
            {hasPending && <span className="tab-diff-badge">↻</span>}
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeFile(f.path);
              }}
              title="Close"
            >×</button>
          </div>
        );
      })}
    </div>
  );
};
