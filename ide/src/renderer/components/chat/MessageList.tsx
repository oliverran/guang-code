import React from 'react';
import { useChatStore, ChatMessage } from '../../store/chat';
import { ToolCallCard } from './ToolCallCard';

export const MessageList: React.FC = () => {
  const messages = useChatStore((s) => s.messages);
  if (messages.length === 0) {
    return (
      <div className="chat-empty">
        <div className="chat-empty-title">Start a conversation</div>
        <div className="chat-empty-hint">Ask the agent to read, write, or run code in your project.</div>
      </div>
    );
  }
  return (
    <div className="chat-message-list">
      {messages.map((m) => <Message key={m.id} msg={m} />)}
    </div>
  );
};

const Message: React.FC<{ msg: ChatMessage }> = ({ msg }) => {
  return (
    <div className={'chat-msg chat-msg-' + msg.role}>
      <div className="chat-msg-role">{msg.role}</div>
      <div className="chat-msg-content">
        {msg.content || (msg.pending ? <span className="chat-msg-pending">thinking…</span> : null)}
        {msg.error && <div className="chat-msg-error">⚠ {msg.error}</div>}
      </div>
      {msg.toolCalls.length > 0 && (
        <div className="chat-msg-tools">
          {msg.toolCalls.map((tc) => <ToolCallCard key={tc.id} tc={tc} />)}
        </div>
      )}
    </div>
  );
};
