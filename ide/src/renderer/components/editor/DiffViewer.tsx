import React, { useMemo, useState } from 'react';
import { diffLines } from 'diff';
import { useIdeStore } from '../../store/ide';

interface Props {
  path: string;
}

export const DiffViewer: React.FC<Props> = ({ path }) => {
  const diff = useIdeStore((s) => s.pendingDiffs.get(path));
  const acceptDiff = useIdeStore((s) => s.acceptDiff);
  const rejectDiff = useIdeStore((s) => s.rejectDiff);
  const [busy, setBusy] = useState(false);

  const hunks = useMemo(() => {
    if (!diff) return [];
    return diffLines(diff.before, diff.after);
  }, [diff]);

  if (!diff) return null;

  return (
    <div className="diff-viewer">
      <div className="diff-header">
        <span className="diff-path">{path}</span>
        <div className="diff-actions">
          <button
            className="btn btn-reject"
            disabled={busy}
            onClick={() => { setBusy(true); rejectDiff(path); setBusy(false); }}
          >Reject</button>
          <button
            className="btn btn-accept"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await acceptDiff(path); } finally { setBusy(false); }
            }}
          >Accept</button>
        </div>
      </div>
      <div className="diff-body">
        {hunks.map((h, i) => (
          <React.Fragment key={i}>
            {h.added && h.value.split('\n').map((line, j) => (
              <div key={`a${i}-${j}`} className="diff-line diff-add">+ {line}</div>
            ))}
            {h.removed && h.value.split('\n').map((line, j) => (
              <div key={`r${i}-${j}`} className="diff-line diff-remove">- {line}</div>
            ))}
            {!h.added && !h.removed && h.value.split('\n').map((line, j) => (
              <div key={`c${i}-${j}`} className="diff-line diff-context">&nbsp; {line}</div>
            ))}
          </React.Fragment>
        ))}
      </div>
    </div>
  );
};
