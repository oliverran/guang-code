import React, { useState, useRef, useEffect } from 'react';

interface Props {
  onSend: (text: string) => void;
  onStop: () => void;
  sending: boolean;
  disabled?: boolean;
}

export const Composer: React.FC<Props> = ({ onSend, onStop, sending, disabled }) => {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow textarea up to a max height
  useEffect(() => {
    const ta = ref.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = Math.min(200, ta.scrollHeight) + 'px';
  }, [text]);

  const submit = () => {
    const t = text.trim();
    if (!t || disabled || sending) return;
    onSend(t);
    setText('');
  };

  return (
    <div className={'chat-composer' + (disabled ? ' disabled' : '')}>
      <textarea
        ref={ref}
        className="chat-input"
        placeholder={disabled ? 'Open a folder and wait for backend…' : 'Ask the agent… (Enter to send, Shift+Enter for newline)'}
        value={text}
        disabled={disabled}
        rows={1}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            submit();
          }
        }}
      />
      <div className="chat-composer-actions">
        {sending ? (
          <button className="btn btn-stop" onClick={onStop}>Stop</button>
        ) : (
          <button
            className="btn btn-send"
            disabled={disabled || !text.trim()}
            onClick={submit}
          >Send</button>
        )}
      </div>
    </div>
  );
};
