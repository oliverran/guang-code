import React, { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor';

// Configure Monaco workers lazily inside the component so that the module
// top-level (which is evaluated synchronously on import) does NOT eagerly
// construct any Worker / URL. This avoids crashing the whole React tree if a
// worker URL fails to resolve in the renderer environment.
function configureMonacoEnvironment() {
  if ((self as any).__MONACO_ENV_CONFIGURED__) return;
  (self as any).__MONACO_ENV_CONFIGURED__ = true;

  // Build worker URLs as plain strings (no `new URL` / import.meta.url here)
  // so Vite's static analysis does not mistake them for glob patterns.
  const base = (window as any).location.origin + '/node_modules/';
  const workerUrl = (subPath: string) => base + 'monaco-editor/esm/vs/' + subPath;

  (self as any).MonacoEnvironment = {
    getWorkerUrl(_moduleId: string, label: string) {
      switch (label) {
        case 'json':
          return workerUrl('language/json/json.worker.js');
        case 'css':
        case 'scss':
        case 'less':
          return workerUrl('language/css/css.worker.js');
        case 'html':
        case 'handlebars':
        case 'razor':
          return workerUrl('language/html/html.worker.js');
        case 'typescript':
        case 'javascript':
          return workerUrl('language/typescript/ts.worker.js');
        default:
          return workerUrl('editor/editor.worker.js');
      }
    },
  };
}

interface Props {
  path: string;
  language: string;
  value: string;
  onChange: (v: string) => void;
}

export const MonacoEditor: React.FC<Props> = ({ path, language, value, onChange }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const modelRef = useRef<monaco.editor.ITextModel | null>(null);

  useEffect(() => {
    configureMonacoEnvironment();
    if (!containerRef.current) return;

    const model = monaco.editor.createModel(value, language);
    modelRef.current = model;

    const editor = monaco.editor.create(containerRef.current, {
      model,
      theme: 'vs-dark',
      automaticLayout: true,
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: true, scale: 1, renderCharacters: false },
      scrollBeyondLastLine: false,
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      renderWhitespace: 'selection',
      tabSize: 2,
      detectIndentation: true,
      wordWrap: 'off',
      padding: { top: 8, bottom: 8 },
    });
    editorRef.current = editor;

    const sub = editor.onDidChangeModelContent(() => {
      onChange(editor.getValue());
    });

    return () => {
      sub.dispose();
      editor.dispose();
      model.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, language]);

  // Sync external value changes (e.g. file reloaded) — only when value diverges from model
  useEffect(() => {
    const editor = editorRef.current;
    const model = modelRef.current;
    if (!editor || !model) return;
    if (model.getValue() !== value) {
      model.setValue(value);
    }
  }, [value]);

  return <div className="monaco-container" ref={containerRef} />;
};
