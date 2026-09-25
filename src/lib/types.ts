export type Sender = 'user' | 'claude' | 'system';
export type MessageStatus = 'sent' | 'queued' | 'processing' | 'done' | 'error' | 'cancelled';

export interface MessageMeta {
  cost_usd?: number;
  duration_ms?: number;
  session_id?: string;
  is_error?: boolean;
  turns?: number;
}

export interface Message {
  id: string;
  sender: Sender;
  body: string;
  status: MessageStatus;
  reply_to: string | null;
  meta: MessageMeta;
  created_at: string;
  updated_at: string;
}

export interface AgentState {
  id: number;
  online: boolean;
  activity: string | null;
  machine: string | null;
  session_id: string | null;
  version: string | null;
  last_seen: string | null;
  updated_at: string;
}
