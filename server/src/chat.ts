import type { ChatMessage, PublicUser } from '../../shared/types.js';
import { config } from './config.js';
import { JsonFile, dataPath } from './store.js';
import { HttpError, newId } from './util.js';

const files = new Map<string, JsonFile<ChatMessage[]>>();

function fileFor(templateId: string): JsonFile<ChatMessage[]> {
  let f = files.get(templateId);
  if (!f) {
    f = new JsonFile<ChatMessage[]>(dataPath('chat', `${templateId}.json`), () => []);
    files.set(templateId, f);
  }
  return f;
}

export function chatHistory(templateId: string, limit = 100): ChatMessage[] {
  const list = fileFor(templateId).data;
  return list.slice(-limit);
}

export function addChatMessage(templateId: string, user: PublicUser, rawText: unknown): ChatMessage {
  const text = typeof rawText === 'string' ? rawText.trim().slice(0, 2000) : '';
  if (!text) throw new HttpError(400, '메시지를 입력해 주세요.');
  const f = fileFor(templateId);
  const msg: ChatMessage = { id: newId(), user, text, at: Date.now() };
  f.data.push(msg);
  if (f.data.length > config.chatLimit) f.data.splice(0, f.data.length - config.chatLimit);
  f.save();
  return msg;
}

export function deleteChat(templateId: string): void {
  fileFor(templateId).delete();
  files.delete(templateId);
}
