import React, { useEffect, useState } from 'react';

interface MemoryEntry {
  domain: string;
  key: string;
  value: string;
}

export const MemoryPanel: React.FC = () => {
  const [entries, setEntries] = useState<MemoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchMemory().then(setEntries).finally(() => setLoading(false));
  }, []);

  const filtered = entries.filter((e) =>
    !query || `${e.domain} ${e.key} ${e.value}`.toLowerCase().includes(query.toLowerCase())
  );

  return (
    <div className="sidebar-panel">
      <div className="sidebar-panel-header">
        Memory
        <span className="sidebar-panel-count">{entries.length}</span>
      </div>
      <input
        className="sidebar-search"
        placeholder="Search memory…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      {loading && <div className="sidebar-loading">Loading…</div>}
      {!loading && filtered.length === 0 && (
        <div className="sidebar-empty-message">No matching entries</div>
      )}
      {!loading && filtered.map((e, i) => (
        <div key={i} className="memory-item">
          <div className="memory-key">
            <span className="memory-domain">{e.domain}</span>
            <span className="memory-name">{e.key}</span>
          </div>
          <div className="memory-value">{e.value}</div>
        </div>
      ))}
    </div>
  );
};

async function fetchMemory(): Promise<MemoryEntry[]> {
  try {
    const status = await window.guang.backend.status();
    if (!status.url) return [];
    const res = await fetch(`${status.url}/sdk/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'memory/list', params: [{}] }),
    });
    const json = await res.json();
    const arr = Array.isArray(json?.result) ? json.result : [];
    return arr.map((r: any) => ({
      domain: r.domain ?? 'default',
      key: r.key ?? r.id ?? '?',
      value: typeof r.value === 'string' ? r.value : JSON.stringify(r.value ?? ''),
    }));
  } catch {
    return [];
  }
}
