import React from 'react';
import { BackendStatus } from '@shared/types';

interface Props {
  backend: BackendStatus;
  projectPath: string | null;
  onPickProject: () => void;
}

export const TitleBar: React.FC<Props> = ({ backend, projectPath, onPickProject }) => {
  return (
    <div className="titlebar">
      <div className="titlebar-drag" />
      <div className="titlebar-content">
        <span className="titlebar-logo">Guang Code</span>
        <button className="titlebar-action" onClick={onPickProject} title="Open project folder">
          {projectPath ? truncatePath(projectPath) : 'Open Folder…'}
        </button>
      </div>
      <div className="titlebar-status">
        {backend.running ? (
          <span className="dot dot-ok" title={`Backend @ ${backend.url}`} />
        ) : (
          <span className="dot dot-warn" title={backend.error ?? 'Backend starting…'} />
        )}
        <span className="titlebar-status-text">
          {backend.running ? 'Ready' : (backend.error ?? 'Starting…')}
        </span>
      </div>
    </div>
  );
};

function truncatePath(p: string, max = 48): string {
  if (p.length <= max) return p;
  const parts = p.split('/');
  if (parts.length <= 3) return p;
  return `…/${parts.slice(-3).join('/')}`;
}
