import React, { useEffect, useState } from 'react';
import { IdeShell } from './components/IdeShell';
import { BackendStatus } from '@shared/types';

declare global {
  interface Window {
    guang: import('@shared/types').GuangApi;
  }
}

export const App: React.FC = () => {
  const [backend, setBackend] = useState<BackendStatus>({ running: false, port: null, url: null, pid: null });
  const [projectPath, setProjectPath] = useState<string | null>(null);

  useEffect(() => {
    // Subscribe to backend status changes from the main process
    const off = window.guang.backend.onStatusChange(setBackend);
    // Pull initial status
    window.guang.backend.status().then(setBackend).catch(() => {});
    return off;
  }, []);

  return (
    <IdeShell
      backend={backend}
      projectPath={projectPath}
      onPickProject={async () => {
        const p = await window.guang.app.openProjectDialog();
        if (p) setProjectPath(p);
      }}
    />
  );
};
