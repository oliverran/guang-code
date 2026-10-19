import React, { useEffect, useState } from 'react';
import { FsEntry } from '@shared/types';
import { useIdeStore } from '../../store/ide';

interface Props {
  rootPath: string | null;
}

export const FileTree: React.FC<Props> = ({ rootPath }) => {
  const tree = useIdeStore((s) => s.tree);
  const setTree = useIdeStore((s) => s.setTree);
  const openFile = useIdeStore((s) => s.openFile);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!rootPath) { setTree(null); return; }
    setLoading(true);
    setErr(null);
    window.guang.fs.listTree(rootPath, 8)
      .then((t) => setTree(t))
      .catch((e) => setErr(String(e)))
      .finally(() => setLoading(false));
  }, [rootPath, setTree]);

  if (!rootPath) return <Empty message="No folder opened" hint="Click 'Open Folder…' in the title bar" />;
  if (loading) return <div className="sidebar-loading">Loading…</div>;
  if (err) return <div className="sidebar-error">⚠ {err}</div>;
  if (!tree) return null;

  return (
    <div className="file-tree">
      <div className="file-tree-header">{tree.name}</div>
      <TreeNode node={tree} depth={0} onOpen={openFile} />
    </div>
  );
};

interface NodeProps {
  node: FsEntry;
  depth: number;
  onOpen: (file: any) => void;
}

const TreeNode: React.FC<NodeProps> = ({ node, depth, onOpen }) => {
  const [open, setOpen] = useState(depth < 2);

  if (!node.isDirectory) {
    return (
      <div
        className="tree-leaf"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={async () => {
          if (!node.path) return;
          const f = await window.guang.fs.readFile(node.path);
          onOpen(f);
        }}
      >
        <span className="tree-icon">📄</span>
        <span className="tree-name">{node.name}</span>
      </div>
    );
  }

  return (
    <div className="tree-branch">
      <div
        className="tree-branch-header"
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="tree-caret">{open ? '▾' : '▸'}</span>
        <span className="tree-icon">📁</span>
        <span className="tree-name">{node.name}</span>
      </div>
      {open && node.children?.map((child) => (
        <TreeNode key={child.path} node={child} depth={depth + 1} onOpen={onOpen} />
      ))}
    </div>
  );
};

const Empty: React.FC<{ message: string; hint?: string }> = ({ message, hint }) => (
  <div className="sidebar-empty">
    <div className="sidebar-empty-message">{message}</div>
    {hint && <div className="sidebar-empty-hint">{hint}</div>}
  </div>
);
