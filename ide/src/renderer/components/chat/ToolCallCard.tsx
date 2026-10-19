import React, { useState } from 'react';
import { ToolCall } from '../../store/chat';
import { useChatStore } from '../../store/chat';

interface Props { tc: ToolCall }

export const ToolCallCard: React.FC<Props> = ({ tc }) => {
  const decidePermission = useChatStore((s) => s.decidePermission);
  const [open, setOpen] = useState(false);
  const statusClass =
    tc.status === 'awaiting_permission' ? 'tc-pending'
    : tc.status === 'running' ? 'tc-running'
    : tc.status === 'done' ? 'tc-done'
    : tc.status === 'denied' ? 'tc-denied'
    : tc.status === 'error' ? 'tc-error' : '';

  return (
    <div className={'tool-call ' + statusClass}>
      <div className="tool-call-header" onClick={() => setOpen((v) => !v)}>
        <span className="tool-call-status">●</span>
        <span className="tool-call-name">{tc.name}</span>
        <span className="tool-call-action">{open ? '▾' : '▸'}</span>
      </div>
      {open && (
        <div className="tool-call-body">
          <div className="tool-call-section">
            <div className="tool-call-label">Input</div>
            <pre className="tool-call-code">{formatJson(tc.input)}</pre>
          </div>
          {tc.output !== null && tc.output !== undefined && (
            <div className="tool-call-section">
              <div className="tool-call-label">Output</div>
              <pre className="tool-call-code">{formatJson(tc.output)}</pre>
            </div>
          )}
          {tc.status === 'awaiting_permission' && (
            <div className="tool-call-permission">
              <div className="tool-call-permission-msg">
                Agent wants to run this. {tc.reason ? `(${tc.reason})` : ''}
              </div>
              <div className="tool-call-permission-actions">
                <button className="btn btn-reject" onClick={() => decidePermission(tc.id, 'deny')}>Deny</button>
                <button className="btn btn-accept" onClick={() => decidePermission(tc.id, 'allow')}>Allow</button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

function formatJson(x: unknown): string {
  if (x == null) return '';
  if (typeof x === 'string') return x;
  try { return JSON.stringify(x, null, 2); } catch { return String(x); }
}
