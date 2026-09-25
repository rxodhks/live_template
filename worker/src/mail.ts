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
