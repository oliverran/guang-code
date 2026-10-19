import React from 'react';
import { BottomView } from './IdeShell';
import { XTerminal } from './terminal/XTerminal';

interface Props {
  view: BottomView;
  onChange: (v: BottomView) => void;
  projectPath: string | null;
}

const TABS: { id: NonNullable<BottomView>; label: string }[] = [
  { id: 'terminal', label: 'Terminal' },
  { id: 'problems', label: 'Problems' },
  { id: 'output', label: 'Output' },
];

export const BottomPanel: React.FC<Props> = ({ view, onChange, projectPath }) => {
  return (
    <div className="bottom-panel">
      <div className="bottom-tabs">
        {TABS.map((t) => (
          <button
            key={t.id}
            className={'bottom-tab' + (view === t.id ? ' active' : '')}
            onClick={() => onChange(view === t.id ? null : t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {view && (
        <div className="bottom-content">
          {view === 'terminal' && <XTerminal cwd={projectPath} />}
          {view === 'problems' && <div className="bottom-empty">No problems detected.</div>}
          {view === 'output' && <div className="bottom-empty">No output yet.</div>}
        </div>
      )}
    </div>
  );
};
