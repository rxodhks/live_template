import type { Env } from './env';

/*
 * 인증 코드 메일 (resend.com HTTP API)
 * 무료 요금제: 하루 100통 · 한 달 3,000통. 보내는 도메인(madang.party)을 Resend에 등록해야 한다.
 */

const DEFAULT_FROM = 'Madang <login@madang.party>';

function html(code: string): string {
  const digits = code
    .split('')
    .map((d) => `<span style="display:inline-block;width:40px;padding:10px 0;margin:0 3px;border-radius:10px;background:#f1f3f5;font-size:26px;font-weight:700;color:#11181c">${d}</span>`)
    .join('');
  return `<!doctype html><html lang="ko"><body style="margin:0;padding:32px 16px;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#11181c">
<div style="max-width:440px;margin:0 auto;background:#fff;border-radius:16px;padding:32px 28px;border:1px solid #e6e8eb">
<div style="font-size:18px;font-weight:700;margin-bottom:20px"><span style="display:inline-block;width:22px;height:22px;border:3px solid #11181c;border-radius:6px;vertical-align:-5px;margin-right:8px;box-sizing:border-box"></span>Madang</div>
<h1 style="font-size:20px;margin:0 0 8px">로그인 인증 코드</h1>
<p style="margin:0 0 20px;color:#687076;font-size:14px;line-height:1.6">아래 6자리 코드를 로그인 화면에 입력해 주세요. 코드는 <b>10분</b> 동안만 쓸 수 있습니다.</p>
<div style="text-align:center;margin:0 0 20px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace">${digits}</div>
<p style="margin:0;color:#889096;font-size:12px;line-height:1.6">직접 요청하지 않았다면 이 메일은 무시해도 됩니다. 누군가 이메일 주소를 잘못 입력했을 수 있습니다.</p>
</div>
<p style="text-align:center;color:#adb5bd;font-size:12px;margin:16px 0 0">Madang · 함께 만드는 작업 마당 · madang.party</p>
</body></html>`;
}

const plain = (code: string) =>
  `Madang 로그인 인증 코드: ${code}\n\n로그인 화면에 위 6자리 코드를 입력해 주세요. 코드는 10분 동안만 쓸 수 있습니다.\n직접 요청하지 않았다면 이 메일은 무시해도 됩니다.\n\nMadang · madang.party`;

export async function sendLoginCode(env: Env, to: string, code: string): Promise<void> {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || DEFAULT_FROM,
      to: [to],
      subject: `Madang 로그인 코드: ${code}`,
      html: html(code),
      text: plain(code),
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
}

const escape = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);

/** 앱 안 "피드백 보내기"로 온 의견을 운영자에게 */
export async function sendFeedback(env: Env, to: string, from: { name: string; id: string }, message: string, context: Record<string, unknown>): Promise<void> {
  const lines = Object.entries(context).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`);
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: env.EMAIL_FROM || DEFAULT_FROM,
      to: [to],
      subject: `[Madang 피드백] ${from.name}: ${message.replace(/\s+/g, ' ').slice(0, 40)}`,
      text: `${from.name} (${from.id})\n\n${message}\n\n---\n${lines.join('\n')}`,
      html: `<p><b>${escape(from.name)}</b> <span style="color:#889096">(${escape(from.id)})</span></p><p style="white-space:pre-wrap">${escape(message)}</p><hr><pre style="color:#687076;font-size:12px;white-space:pre-wrap">${escape(lines.join('\n'))}</pre>`,
    }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
}

export interface LoginAlert {
  /** 브라우저 · 운영체제 */
  device: string;
  /** 대략적인 위치 (도시, 국가) — 모르면 빈 문자열 */
  place: string;
  at: number;
  /** 사이트 주소 (https://madang.party) */
  origin: string;
}

const kst = (at: number) =>
  new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', dateStyle: 'long', timeStyle: 'short' }).format(new Date(at)) + ' (한국 시간)';

/** 보안 알림 종류: 처음 보는 기기의 로그인 · 새 패스키 등록 */
export type SecurityAlertKind = 'login' | 'passkey';

const ALERT_COPY: Record<SecurityAlertKind, { title: string; lead: string; subject: string; fix: string }> = {
  login: {
    title: '새 기기에서 로그인했습니다',
    lead: '처음 보는 기기(또는 브라우저)에서 내 Madang 계정으로 로그인했습니다.',
    subject: '새 기기 로그인',
    fix: '바로 로그인한 뒤 <b>프로필 수정 → 로그인된 기기</b>에서 <b>다른 기기 모두 로그아웃</b>을 누르고, <b>패스키</b> 목록에 모르는 패스키가 있으면 삭제해 주세요.',
  },
  passkey: {
    title: '새 패스키가 등록되었습니다',
    lead: '내 Madang 계정에 새 패스키가 등록되었습니다. 이 패스키로는 이메일 · 인증 코드 없이 로그인할 수 있습니다.',
    subject: '새 패스키 등록',
    fix: '바로 로그인한 뒤 <b>프로필 수정 → 패스키</b>에서 이 패스키를 삭제하고, <b>로그인된 기기</b>에서 <b>다른 기기 모두 로그아웃</b>을 눌러 주세요.',
  },
};

/** 계정 보안 알림: 처음 보는 기기에서 로그인했거나 새 패스키가 등록되었을 때 계정 주인에게 알린다 */
export async function sendSecurityAlert(env: Env, to: string, kind: SecurityAlertKind, alert: LoginAlert): Promise<void> {
  const copy = ALERT_COPY[kind];
  const rows: [string, string][] = [
    ['기기', alert.device],
    ['시간', kst(alert.at)],
    ...(alert.place ? ([['대략적인 위치', alert.place]] as [string, string][]) : []),
  ];
  const table = rows
    .map(([k, v]) => `<tr><td style="padding:6px 12px 6px 0;color:#687076;white-space:nowrap">${k}</td><td style="padding:6px 0;font-weight:600">${escape(v)}</td></tr>`)
    .join('');
  const html = `<!doctype html><html lang="ko"><body style="margin:0;padding:32px 16px;background:#f8f9fa;font-family:-apple-system,BlinkMacSystemFont,'Apple SD Gothic Neo','Malgun Gothic',sans-serif;color:#11181c">
<div style="max-width:440px;margin:0 auto;background:#fff;border-radius:16px;padding:32px 28px;border:1px solid #e6e8eb">
<div style="font-size:18px;font-weight:700;margin-bottom:20px"><span style="display:inline-block;width:22px;height:22px;border:3px solid #11181c;border-radius:6px;vertical-align:-5px;margin-right:8px;box-sizing:border-box"></span>Madang</div>
<h1 style="font-size:20px;margin:0 0 8px">${copy.title}</h1>
<p style="margin:0 0 16px;color:#687076;font-size:14px;line-height:1.6">${copy.lead}</p>
<table style="font-size:14px;border-collapse:collapse;margin:0 0 20px">${table}</table>
<p style="margin:0 0 8px;font-size:14px;line-height:1.6">본인이라면 이 메일은 무시해도 됩니다.</p>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6"><b>본인이 아니라면</b> ${copy.fix} 메일 계정의 비밀번호도 바꾸는 것이 좋습니다.</p>
<a href="${escape(alert.origin)}/" style="display:inline-block;background:#11181c;color:#fff;text-decoration:none;padding:10px 18px;border-radius:10px;font-size:14px;font-weight:600">Madang 열기</a>
</div>
<p style="text-align:center;color:#adb5bd;font-size:12px;margin:16px 0 0">Madang · 함께 만드는 작업 마당 · madang.party</p>
</body></html>`;
  const text = `Madang: ${copy.title}\n\n${copy.lead}\n\n${rows.map(([k, v]) => `${k}: ${v}`).join('\n')}\n\n본인이라면 이 메일은 무시해도 됩니다.\n본인이 아니라면 ${copy.fix.replace(/<\/?b>/g, '')} 메일 계정의 비밀번호도 바꾸는 것이 좋습니다.\n\n${alert.origin}/`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.EMAIL_FROM || DEFAULT_FROM, to: [to], subject: `Madang ${copy.subject}: ${alert.device}`, html, text }),
  });
  if (!res.ok) throw new Error(`Resend ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
}
