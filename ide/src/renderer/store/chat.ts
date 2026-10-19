import { create } from 'zustand';
import { ChatEvent } from '@shared/types';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls: ToolCall[];
  pending: boolean;
  error?: string;
  ts: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output: unknown;
  status: 'pending' | 'running' | 'awaiting_permission' | 'done' | 'denied' | 'error';
  delta?: string;
  reason?: string;
}

interface ChatState {
  requestId: string | null;
  messages: ChatMessage[];
  sending: boolean;

  startRequest: (reqId: string, userMessage: string) => void;
  applyEvent: (reqId: string, ev: ChatEvent) => void;
  finishRequest: (reqId: string) => void;
  decidePermission: (toolCallId: string, decision: 'allow' | 'deny') => void;
  clear: () => void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  requestId: null,
  messages: [],
  sending: false,

  startRequest: (reqId, userMessage) => {
    set({
      requestId: reqId,
      sending: true,
      messages: [
        ...get().messages,
        {
          id: reqId + ':user',
          role: 'user',
          content: userMessage,
          toolCalls: [],
          pending: false,
          ts: Date.now(),
        },
        {
          id: reqId,
          role: 'assistant',
          content: '',
          toolCalls: [],
          pending: true,
          ts: Date.now(),
        },
      ],
    });
  },

  applyEvent: (reqId, ev) => {
    const messages = [...get().messages];
    const idx = messages.findIndex((m) => m.id === reqId);
    if (idx === -1) return;
    const m = { ...messages[idx], toolCalls: [...messages[idx].toolCalls] };

    switch (ev.type) {
      case 'content_delta':
        m.content += ev.delta;
        break;
      case 'content_done':
        m.content = ev.content;
        break;
      case 'tool_call_start': {
        m.toolCalls.push({
          id: ev.toolCallId,
          name: ev.toolName,
          input: ev.input,
          output: null,
          status: 'running',
        });
        break;
      }
      case 'tool_call_delta': {
        const tc = m.toolCalls.find((x) => x.id === ev.toolCallId);
        if (tc) tc.delta = (tc.delta ?? '') + ev.delta;
        break;
      }
      case 'tool_call_done': {
        const tc = m.toolCalls.find((x) => x.id === ev.toolCallId);
        if (tc) {
          tc.output = ev.output;
          tc.status = 'done';
        }
        break;
      }
      case 'permission_request': {
        const tc = m.toolCalls.find((x) => x.id === ev.toolCallId);
        if (tc) {
          tc.status = 'awaiting_permission';
          tc.reason = ev.reason;
          tc.input = ev.input;
        }
        break;
      }
      case 'permission_resolved': {
        const tc = m.toolCalls.find((x) => x.id === ev.toolCallId);
        if (tc) {
          tc.status = ev.decision === 'allow' ? 'running' : 'denied';
        }
        break;
      }
      case 'message_done':
        m.pending = false;
        break;
      case 'error':
        m.pending = false;
        m.error = ev.message;
        break;
    }

    messages[idx] = m;
    set({ messages });
  },

  finishRequest: (reqId) => {
    if (get().requestId !== reqId) return;
    set({ sending: false, requestId: null });
  },

  decidePermission: (toolCallId, decision) => {
    const messages = [...get().messages];
    const tc = messages.flatMap((m) => m.toolCalls).find((x) => x.id === toolCallId);
    if (!tc) return;
    const reqId = get().requestId;
    if (!reqId) return;
    window.guang.chat.permissionDecide(reqId, toolCallId, decision).catch(() => {});
  },

  clear: () => set({ messages: [], sending: false, requestId: null }),
}));
