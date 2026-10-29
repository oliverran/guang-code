import React, { useEffect, useRef } from 'react';
import { useChatStore } from '../store/chat';
import { useIdeStore } from '../store/ide';
import { BackendStatus, ChatEvent } from '@shared/types';
import { MessageList } from './chat/MessageList';
import { Composer } from './chat/Composer';

interface Props {
  backend: BackendStatus;
  projectPath: string | null;
}

export const ChatPanel: React.FC<Props> = ({ backend, projectPath }) => {
  const messages = useChatStore((s) => s.messages);
  const sending = useChatStore((s) => s.sending);
  const requestId = useChatStore((s) => s.requestId);
  const startRequest = useChatStore((s) => s.startRequest);
  const applyEvent = useChatStore((s) => s.applyEvent);
  const finishRequest = useChatStore((s) => s.finishRequest);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Subscribe to SSE events proxied from main
  useEffect(() => {
    const off = window.guang.chat.onEvent((reqId, ev) => {
      applyEvent(reqId, ev);
      if (ev.type === 'message_done' || ev.type === 'error') {
        finishRequest(reqId);
      }
    });
    return off;
  }, [applyEvent, finishRequest]);

  // Auto-scroll on new content
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  const send = async (text: string) => {
    if (!backend.running || sending) return;
    if (!projectPath) return;
    // The preload bridge mints the request id and stamps it on every event of this
    // stream, so the pending message must be keyed by the id it returns: an id
    // invented here never matches, and every event is dropped on the floor.
    try {
      const reqId = await window.guang.chat.start(null, text, { cwd: projectPath });
      startRequest(reqId, text);
    } catch (err) {
      // No stream exists to key against, so surface the failure on a local id.
      const reqId = `local_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
      startRequest(reqId, text);
      applyEvent(reqId, { type: 'error', message: String(err) });
      finishRequest(reqId);
    }
  };

  const stop = () => {
    if (requestId) window.guang.chat.cancel(requestId).catch(() => {});
  };

  return (
    <aside className="chat-panel">
      <div className="chat-header">
        <span className="chat-title">AI Chat</span>
        <span className="chat-mode">Agent</span>
      </div>
      <div className="chat-messages" ref={scrollRef}>
        <MessageList />
      </div>
      <Composer onSend={send} onStop={stop} sending={sending} disabled={!backend.running || !projectPath} />
    </aside>
  );
};
