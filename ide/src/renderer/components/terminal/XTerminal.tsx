import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import 'xterm/css/xterm.css';

interface Props {
  cwd: string | null;
}

export const XTerminal: React.FC<Props> = ({ cwd }) => {
  const ref = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const idRef = useRef<string | null>(null);

  useEffect(() => {
    if (!ref.current) return;

    const term = new Terminal({
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
      fontSize: 12,
      lineHeight: 1.2,
      cursorBlink: true,
      theme: {
        background: '#0b1220',
        foreground: '#e2e8f0',
        cursor: '#22d3ee',
        selectionBackground: '#1f2d4e',
      },
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(ref.current);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    let inputDisposable = term.onData((data) => {
      if (idRef.current) window.guang.terminal.write(idRef.current, data);
    });

    const onResize = () => fit.fit();
    const ro = new ResizeObserver(onResize);
    ro.observe(ref.current);

    if (cwd) {
      window.guang.terminal.spawn({ cols: term.cols, rows: term.rows, cwd })
        .then(({ id }) => {
          idRef.current = id;
          term.writeln('\x1b[90m# Guang Code IDE — terminal ready\x1b[0m');
        })
        .catch((err) => term.writeln(`\x1b[31m# Failed to start terminal: ${err}\x1b[0m`));
    }

    const dataOff = window.guang.terminal.onData((ev) => {
      if (ev.id === idRef.current) term.write(ev.data);
    });
    const exitOff = window.guang.terminal.onExit((ev) => {
      if (ev.id === idRef.current) {
        term.writeln(`\r\n\x1b[90m# Process exited with code ${ev.code}\x1b[0m`);
      }
    });

    return () => {
      ro.disconnect();
      inputDisposable.dispose();
      dataOff();
      exitOff();
      if (idRef.current) window.guang.terminal.kill(idRef.current);
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      idRef.current = null;
    };
  }, [cwd]);

  return <div className="xterm-container" ref={ref} />;
};
