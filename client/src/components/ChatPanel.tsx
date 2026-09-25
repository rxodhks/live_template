import { useEffect, useRef, useState } from 'react';
import { MessageSquare, Send, X } from 'lucide-react';
import { useWorkspace } from '../workspace/context';
import { useSession } from '../store/session';
import { toast } from '../store/toasts';
import { Avatar, EmptyState, IconButton } from './ui';
import { formatTime, dayKey, dayLabel } from '../lib/time';
import { cx } from '../lib/util';

/** 템플릿 멤버끼리의 실시간 채팅 (자동 저장, 최근 500개 보관) */
export function ChatPanel() {
  const { chat, setChatOpen, template, room } = useWorkspace();
  const me = useSession((s) => s.user)!;
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length]);

  const send = async () => {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    const res = room ? await room.request({ t: 'chat', text: value }) : { ok: false, error: '협업 공간에서만 채팅할 수 있습니다.' };
    setSending(false);
    if (!res.ok) {
      toast.error('메시지를 보내지 못했습니다', res.error);
      return;
    }
    setText('');
  };

  return (
    <div className="chat">
      <header className="drawer-header">
        <MessageSquare size={16} />
        <h3>채팅</h3>
        <span className="muted small">{template.members.length}명</span>
        <IconButton label="채팅 닫기" size="sm" onClick={() => setChatOpen(false)}>
          <X size={16} />
        </IconButton>
      </header>
      <div className="chat-list" ref={listRef}>
        {chat.length === 0 && (
          <EmptyState icon={<MessageSquare size={28} />} title="아직 대화가 없습니다">
            팀원들과 아이디어를 나눠 보세요.
          </EmptyState>
        )}
        {chat.map((m, i) => {
          const prev = chat[i - 1];
          const newDay = !prev || dayKey(prev.at) !== dayKey(m.at);
          const grouped = !newDay && prev && prev.user.id === m.user.id && m.at - prev.at < 3 * 60_000;
          const mine = m.user.id === me.id;
          return (
            <div key={m.id}>
              {newDay && <div className="chat-day">{dayLabel(m.at)}</div>}
              <div className={cx('chat-msg', mine && 'is-mine', grouped && 'is-grouped')}>
                {!grouped && <Avatar user={m.user} size={28} />}
                <div className="chat-content">
                  {!grouped && (
                    <div className="chat-meta">
                      <b style={{ color: m.user.color }}>{m.user.name}</b>
                      <span>{formatTime(m.at)}</span>
                    </div>
                  )}
                  <div className="chat-text">{m.text}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="chat-input">
        <textarea
          value={text}
          rows={1}
          placeholder="메시지 입력 · Enter 전송, Shift+Enter 줄바꿈"
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void send();
            }
          }}
        />
        <IconButton label="보내기" onClick={() => void send()} disabled={!text.trim() || sending} tipSide="top">
          <Send size={16} />
        </IconButton>
      </div>
    </div>
  );
}
