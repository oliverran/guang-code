import React, { useEffect, useState } from 'react';

interface Skill {
  id: string;
  name?: string;
  scope?: string;
  description?: string;
}

export const SkillsPanel: React.FC = () => {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [loading, setLoading] = useState(false);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    setLoading(true);
    fetchSkills().then(setSkills).finally(() => setLoading(false));
  }, []);

  const visible = skills.filter((s) =>
    !filter || (s.name ?? s.id).toLowerCase().includes(filter.toLowerCase())
  );

  return (
    <div className="sidebar-panel">
      <div className="sidebar-panel-header">
        Skills
        <span className="sidebar-panel-count">{skills.length}</span>
      </div>
      <input
        className="sidebar-search"
        placeholder="Filter skills…"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
      />
      {loading && <div className="sidebar-loading">Loading…</div>}
      {!loading && visible.map((s) => (
        <div key={s.id} className="skill-item">
          <div className="skill-name">{s.name ?? s.id}</div>
          <div className="skill-scope">{s.scope ?? 'project'}</div>
        </div>
      ))}
    </div>
  );
};

async function fetchSkills(): Promise<Skill[]> {
  try {
    const status = await window.guang.backend.status();
    if (!status.url) return [];
    const res = await fetch(`${status.url}/sdk/v1`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'skills/list', params: [{}] }),
    });
    const json = await res.json();
    return (json?.result ?? []) as Skill[];
  } catch {
    return [];
  }
}
