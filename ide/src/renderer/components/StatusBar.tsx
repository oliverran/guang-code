import React from 'react';
import { BackendStatus } from '@shared/types';
import { BottomView } from './IdeShell';

interface Props {
  backend: BackendStatus;
  bottomView: BottomView;
  projectPath: string | null;
}

export const StatusBar: React.FC<Props> = ({ backend, bottomView, projectPath }) => {
  return (
    <div className="statusbar">
      <span className="status-item">
        <span className={'status-dot ' + (backend.running ? 'dot-ok' : 'dot-warn')} />
        {backend.running ? 'Backend Ready' : 'Backend Starting'}
      </span>
      <span className="status-item">{projectPath ? truncate(projectPath, 40) : 'No folder'}</span>
      <span className="status-spacer" />
      <span className="status-item">{bottomView ?? ''}</span>
      <span className="status-item">UTF-8</span>
      <span className="status-item">LF</span>
    </div>
  );
};

function truncate(p: string, max: number): string {
  if (p.length <= max) return p;
  return '…' + p.slice(p.length - max + 1);
}
