import React, { useEffect, useState } from 'react';

interface Session {
  id: string;
  title?: string;
  messageCount?: number;
  createdAt?: number;
  archived?: boolean;
}

export const SessionsPanel: React.FC = () => {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    // Talk to backend via JSON-RPC at /sdk/v1
    fetchSessions().then(setSessions).finally(() => setLoading(false));
  }, []);

  return (
    <div className="sidebar-panel">
      <div className="sidebar-panel-header">Sessions</div>
      {loading && <div className="sidebar-loading">Loading…</div>}
      {!loading && sessions.length === 0 && <div className="sidebar-empty-message">No sessions yet</div>}
      {!loading && sessions.map((s) => (
        <div key={s.id} className="session-item">
          <div className="session-title">{s.title || s.id.slice(0, 8)}</div>
          <div className="session-meta">
            {s.messageCount ?? 0} msgs · {new Date(s.createdAt ?? 0).toLocaleString()}
          </div>
        </div>
      ))}
    </div>
  );
};

async function fetchSessions(): Promise<Session[]> {
  try {
    const status = await window.guang.backend.status();
    if (!status.url) return [];
    const res = await fetch(`${status.url}/sdk/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'session/listSessions', params: [{}] }),
    });
    const json = await res.json();
    return (json?.result ?? []) as Session[];
  } catch {
    return [];
  }
}
