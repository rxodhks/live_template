import type { Dict } from '..';
import { MONTHS, plural } from './plural';

/** 앱 전체 · 공용 라이브러리 (App, lib/) */
export default {
  /* App */
  '테스트 사이트 · 실제 사이트와 계정 · 데이터가 분리되어 있습니다': 'Test site · Accounts and data are separate from the live site',
  '개인 템플릿을 클라우드에 백업했습니다': 'Personal templates backed up to the cloud',
  '{n}개 · 이제 다른 기기에서도 이어서 작업할 수 있습니다.': (v) => `${plural(v.n, 'template')} · You can now pick up where you left off on any device.`,
  '자동 저장 중입니다': 'Autosave is on',
  '모든 변경 사항은 입력 즉시 저장되니 따로 저장하지 않아도 됩니다.': 'Every change is saved as you type, so there’s no need to save manually.',
  'Madang은 {desktop}에 맞춰져 있습니다. 창을 넓히면 모든 기능을 편하게 쓸 수 있어요. 모바일은 전용 앱으로 준비 중입니다.':
    'Madang is designed for {desktop}. Widen the window to use every feature comfortably. A dedicated mobile app is on the way.',
  '데스크톱 화면': 'desktop screens',
  '안내 닫기': 'Dismiss',

  /* lib/api */
  '서버에 연결할 수 없습니다. 네트워크 상태를 확인해 주세요.': 'Can’t connect to the server. Check your network connection.',
  '요청 실패 ({status})': 'Request failed ({status})',
  '필요한 화면 파일을 불러오지 못했습니다. 새 버전이 나왔다면 곧 자동으로 새로고침되고, 아니면 인터넷 연결을 확인한 뒤 다시 시도해 주세요.':
    'Some app files couldn’t be loaded. If a new version was just released, the page will refresh automatically. Otherwise, check your internet connection and try again.',
  '알 수 없는 오류가 발생했습니다.': 'An unknown error occurred.',

  /* lib/auth */
  '예전에 참여한 협업 템플릿을 옮겼습니다': 'Your earlier shared templates have been moved',
  '{templates}개의 템플릿을 이 계정에서 계속 쓸 수 있습니다.': (v) => `You can keep using ${plural(v.templates, 'template')} with this account.`,
  '아직 클라우드에 저장되지 않은 내용이 있습니다': 'Some changes haven’t been saved to the cloud yet',
  '개인 템플릿 {n}개가 아직 이 기기에만 있습니다.': (v) => `${Number(v.n) === 1 ? '1 personal template is' : `${v.n} personal templates are`} only on this device so far.`,
  '방금 고친 내용이 아직 저장 중입니다.': 'Your latest edits are still being saved.',
  '로그아웃해도 이 내용은 이 기기에 남겨 두었다가, 다음에 로그인하면 자동으로 저장합니다.':
    'If you sign out, they’ll stay on this device and be saved automatically the next time you sign in.',
  '로그아웃': 'Sign out',
  '로그인이 만료되었습니다': 'Your session has expired',
  '다시 로그인해 주세요.': 'Please sign in again.',

  /* lib/demo · idb */
  '둘러보는 중': 'Guest',
  '로그인 전에는 개인 공간 저장소를 쓸 수 없습니다.': 'Personal storage isn’t available until you sign in.',

  /* lib/invites */
  '1일': '1 day',
  '7일': '7 days',
  '30일': '30 days',
  '만료 없음': 'Never expires',
  '1명만': '1 person',
  '5명까지': 'Up to 5 people',
  '20명까지': 'Up to 20 people',
  '제한 없음': 'No limit',
  '만료됨': 'Expired',
  '{hours}시간 남음': (v) => `${plural(v.hours, 'hour')} left`,
  '{x}일 남음': (v) => `${plural(v.x, 'day')} left`,
  '뷰어': 'Viewer',
  '편집자': 'Editor',
  '{uses}/{maxUses}명 사용': '{uses}/{maxUses} used',
  '{uses}명 사용': '{uses} used',
  '승인 필요': 'Approval required',
  '뷰어(읽기 전용)': 'a viewer (read-only)',
  '{inviter} 님이 Madang의 ‘{templateName}’ 템플릿에 {role}로 초대했습니다{until}.\n{link}\n(PC 브라우저에서 열어 주세요. 휴대폰 화면은 아직 지원하지 않습니다.)': (v) =>
    `${v.inviter} has invited you to join the “${v.templateName}” template on Madang as ${v.role === 'Editor' ? 'an editor' : v.role}${v.until}.\n${v.link}\n(Please open this link in a desktop browser. Mobile screens aren’t supported yet.)`,

  /* lib/markdown */
  '이미지': 'Image',
  '임베드': 'Embed',
  '목차': 'Contents',

  /* lib/notes */
  '비밀 노트를 찾을 수 없습니다.': 'Secret note not found.',
  '비밀번호를 여러 번 틀려 잠시 잠겼습니다. {retryAfter}초 후 다시 시도하세요.': (v) =>
    `Too many incorrect attempts. Try again in ${plural(v.retryAfter, 'second')}.`,
  '비밀번호를 여러 번 틀려 잠시 잠겼습니다. {x}초 후 다시 시도하세요.': (v) => `Too many incorrect attempts. Try again in ${plural(v.x, 'second')}.`,
  '비밀번호가 올바르지 않습니다. (남은 시도 {x}회)': (v) => `Incorrect password. (${plural(v.x, 'attempt')} left)`,
  '노트를 열 수 없습니다.': 'Couldn’t open the note.',
  '노트를 복호화하지 못했습니다. 비밀번호가 바뀌었을 수 있습니다.': 'Couldn’t decrypt the note. The password may have been changed.',

  /* lib/notices */
  '업데이트 완료': 'Update complete',
  '{m}월 {day}일 {time} 업데이트 예정': (v) => `Update scheduled for ${MONTHS[Number(v.m) - 1]} ${v.day}, ${v.time} KST`,

  /* lib/passkey */
  '이 브라우저에서는 패스키를 등록할 수 없습니다. 최신 브라우저에서 다시 시도해 주세요.': 'This browser can’t register passkeys. Please try again in an up-to-date browser.',

  /* lib/pending */
  '참여가 승인되었습니다': 'Your request to join was approved',
  '참여 요청이 거절되었습니다': 'Your request to join was declined',

  /* lib/room · yprovider */
  '서버에 연결되어 있지 않습니다.': 'Not connected to the server.',
  '서버 응답이 없습니다.': 'The server isn’t responding.',
  '연결이 끊겼습니다.': 'The connection was lost.',
  '읽기 전용 권한이라 저장되지 않았습니다.': 'Not saved because you have read-only access.',
  '문서가 너무 커서 더 이상 저장할 수 없습니다.': 'This document is too large to save any more changes.',
  '저장 확인이 지연되고 있습니다.': 'Saving is taking longer than usual.',

  /* lib/templateOps */
  '이름 → {name}': 'Name → {name}',
  '설명 수정': 'Description edited',
  '아이콘 → {emoji}': 'Icon → {emoji}',
  '기능은 하나 이상 필요합니다.': 'At least one feature must be turned on.',
  '기능 → {features}': 'Features → {features}',
  '{name} ({label} 버전)': '{name} (version from {label})',

  /* lib/time */
  '방금 전': 'Just now',
  '오늘': 'Today',
  '어제': 'Yesterday',

  /* lib/turnstile */
  '봇 확인을 불러오지 못했습니다.': 'Couldn’t load the bot check.',
  '봇 확인을 불러오지 못했습니다. 네트워크를 확인해 주세요.': 'Couldn’t load the bot check. Check your network connection.',
  '봇 확인에 실패했습니다. 다시 시도해 주세요.': 'The bot check failed. Please try again.',
  '봇 확인 시간이 지났습니다. 다시 시도해 주세요.': 'The bot check timed out. Please try again.',
  '봇 확인을 다시 시작합니다.': 'Restarting the bot check.',
} satisfies Dict;
