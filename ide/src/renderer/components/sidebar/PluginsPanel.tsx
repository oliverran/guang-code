import React, { useEffect, useState } from 'react';

interface Plugin {
  id: string;
  name?: string;
  version?: string;
  tags?: string[];
  active?: boolean;
}

export const PluginsPanel: React.FC = () => {
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    fetchPlugins().then(setPlugins).finally(() => setLoading(false));
  }, []);

  return (
    <div className="sidebar-panel">
      <div className="sidebar-panel-header">
        Plugins
        <span className="sidebar-panel-count">{plugins.length}</span>
      </div>
      {loading && <div className="sidebar-loading">Loading…</div>}
      {!loading && plugins.length === 0 && (
        <div className="sidebar-empty-message">No plugins installed</div>
      )}
      {!loading && plugins.map((p) => (
        <div key={p.id} className="plugin-item">
          <div className="plugin-name">
            {p.name ?? p.id}
            {p.active && <span className="plugin-active-badge">active</span>}
          </div>
          <div className="plugin-meta">
            {p.version ?? '0.0.0'}
            {p.tags && p.tags.length > 0 && ` · ${p.tags.join(', ')}`}
          </div>
        </div>
      ))}
    </div>
  );
};

async function fetchPlugins(): Promise<Plugin[]> {
  try {
    const status = await window.guang.backend.status();
    if (!status.url) return [];
    const res = await fetch(`${status.url}/sdk/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'plugins/list', params: [{}] }),
    });
    const json = await res.json();
    return (json?.result ?? []) as Plugin[];
  } catch {
    return [];
  }
}
