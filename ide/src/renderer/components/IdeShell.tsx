import React, { useState } from 'react';
import { BackendStatus } from '@shared/types';
import { ActivityBar } from './ActivityBar';
import { Sidebar } from './Sidebar';
import { EditorArea } from './EditorArea';
import { ChatPanel } from './ChatPanel';
import { BottomPanel } from './BottomPanel';
import { StatusBar } from './StatusBar';
import { TitleBar } from './TitleBar';

export type SidebarView = 'explorer' | 'sessions' | 'skills' | 'plugins' | 'memory';
export type BottomView = 'terminal' | 'problems' | 'output' | null;

interface Props {
  backend: BackendStatus;
  projectPath: string | null;
  onPickProject: () => void;
}

export const IdeShell: React.FC<Props> = ({ backend, projectPath, onPickProject }) => {
  const [sidebarView, setSidebarView] = useState<SidebarView>('explorer');
  const [bottomView, setBottomView] = useState<BottomView>('terminal');
  const [chatOpen, setChatOpen] = useState(true);

  return (
    <div className="ide-root">
      <TitleBar backend={backend} projectPath={projectPath} onPickProject={onPickProject} />
      <div className="ide-body">
        <ActivityBar
          active={sidebarView}
          onChange={setSidebarView}
          onToggleChat={() => setChatOpen((v) => !v)}
          chatOpen={chatOpen}
        />
        <Sidebar view={sidebarView} projectPath={projectPath} />
        <div className="ide-center">
          <EditorArea projectPath={projectPath} />
          <BottomPanel view={bottomView} onChange={setBottomView} projectPath={projectPath} />
        </div>
        {chatOpen && <ChatPanel backend={backend} projectPath={projectPath} />}
      </div>
      <StatusBar backend={backend} bottomView={bottomView} projectPath={projectPath} />
    </div>
  );
};
