import React from 'react';
import { SidebarView } from './IdeShell';

interface Props {
  active: SidebarView;
  onChange: (v: SidebarView) => void;
  onToggleChat: () => void;
  chatOpen: boolean;
}

const ITEMS: { id: SidebarView; icon: string; label: string }[] = [
  { id: 'explorer', icon: '📁', label: 'Explorer' },
  { id: 'sessions', icon: '💬', label: 'Sessions' },
  { id: 'skills',   icon: '🧠', label: 'Skills' },
  { id: 'plugins',  icon: '🧩', label: 'Plugins' },
  { id: 'memory',   icon: '📚', label: 'Memory' },
];

export const ActivityBar: React.FC<Props> = ({ active, onChange, onToggleChat, chatOpen }) => {
  return (
    <div className="activity-bar">
      <div className="activity-bar-top">
        {ITEMS.map((it) => (
          <button
            key={it.id}
            className={'activity-item' + (active === it.id ? ' active' : '')}
            onClick={() => onChange(it.id)}
            title={it.label}
          >
            <span className="activity-icon">{it.icon}</span>
          </button>
        ))}
      </div>
      <div className="activity-bar-bottom">
        <button
          className={'activity-item' + (chatOpen ? ' active' : '')}
          onClick={onToggleChat}
          title="Toggle Chat Panel"
        >
          <span className="activity-icon">✨</span>
        </button>
      </div>
    </div>
  );
};
