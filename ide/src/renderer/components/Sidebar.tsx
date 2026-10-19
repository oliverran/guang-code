import React from 'react';
import { SidebarView } from './IdeShell';
import { FileTree } from './sidebar/FileTree';
import { SessionsPanel } from './sidebar/SessionsPanel';
import { SkillsPanel } from './sidebar/SkillsPanel';
import { PluginsPanel } from './sidebar/PluginsPanel';
import { MemoryPanel } from './sidebar/MemoryPanel';

interface Props {
  view: SidebarView;
  projectPath: string | null;
}

export const Sidebar: React.FC<Props> = ({ view, projectPath }) => {
  return (
    <aside className="sidebar">
      {view === 'explorer' && <FileTree rootPath={projectPath} />}
      {view === 'sessions' && <SessionsPanel />}
      {view === 'skills'   && <SkillsPanel />}
      {view === 'plugins'  && <PluginsPanel />}
      {view === 'memory'   && <MemoryPanel />}
    </aside>
  );
};
