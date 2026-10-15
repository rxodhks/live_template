import type { Dict } from '..';
import { plural } from './plural';

/** 대시보드 · 템플릿 만들기 · 초대 · 공지 · 장애 화면 (pages/) */
export default {
  /* CreateTemplateModal */
  '템플릿을 만들었습니다': 'Template created',
  '개인 공간 (인터넷에 연결되면 백업)': 'Personal space (backed up once you’re online)',
  '템플릿을 만들지 못했습니다': 'Couldn’t create the template',
  '사용할 기능을 고르세요. 여러 개를 함께 선택하면 한 템플릿 안에서 동시에 작업할 수 있습니다. 새 템플릿은 개인 공간에 만들어지고, 팀원을 초대하면 협업 공간으로 전환됩니다.':
    'Choose the features you need. Pick more than one to work on them side by side in a single template. New templates start in your personal space and become shared spaces when you invite teammates.',
  '기능을 하나 이상 선택해 주세요': 'Select at least one feature',
  '{features} 템플릿': '{features} template',
  '템플릿 이름': 'Template name',
  '예) 신규 서비스 런칭': 'e.g., New product launch',
  '설명 (선택)': 'Description (optional)',
  '팀원들이 알아야 할 한 줄 설명': 'A one-line summary for your team',
  '기능 선택': 'Features',
  '· 중복 선택 가능': '· Select as many as you like',
  '시작 프리셋': 'Starting preset',
  '만들어질 내용': 'What will be created',

  /* Dashboard */
  '전체': 'All',
  '늦은 밤이에요': 'Working late',
  '좋은 아침이에요': 'Good morning',
  '좋은 오후예요': 'Good afternoon',
  '좋은 저녁이에요': 'Good evening',
  '초대 링크로 참여': 'Join with invite link',
  '받은 초대 링크': 'Invite link you received',
  '열기': 'Open',
  '{greeting}, {name} 님': '{greeting}, {name}',
  '개인 공간 {personal}개 · 협업 공간 {shared}개': (v) => `${plural(v.personal, 'personal space')} · ${plural(v.shared, 'shared space')}`,
  '지금 {n}명이 작업 중': (v) => `${v.n} ${Number(v.n) === 1 ? 'person is' : 'people are'} working now`,
  '참여 요청 {n}건': (v) => plural(v.n, 'request to join', 'requests to join'),
  '새 템플릿': 'New template',
  '참여 승인을 기다리는 중 ({when} 요청)': 'Waiting for approval (requested {when})',
  '공간': 'Space',
  '기능': 'Feature',
  '모든 기능': 'All features',
  '템플릿 검색': 'Search templates',
  '조건에 맞는 템플릿이 없습니다': 'No matching templates',
  '필터나 검색어를 바꿔 보세요.': 'Try a different filter or search term.',
  '첫 템플릿을 만들어 보세요': 'Create your first template',
  '디자인·코딩·문서 중 필요한 기능을 골라 개인 공간에서 시작하고, 필요할 때 팀원을 초대하세요.':
    'Choose what you need from design, coding and docs, start in your personal space, and invite teammates when you’re ready.',
  '템플릿 만들기': 'Create template',
  '템플릿에서 나갈까요?': 'Leave this template?',
  '다시 참여하려면 새 초대 링크가 필요합니다.': 'You’ll need a new invite link to rejoin.',
  '나가기': 'Leave',
  '템플릿에서 나왔습니다': 'You left the template',
  '실패했습니다': 'Something went wrong',
  '팀원 초대 (협업 공간으로 전환)': 'Invite teammates (turns it into a shared space)',
  '템플릿 삭제': 'Delete template',
  '템플릿 나가기': 'Leave template',
  '더 보기': 'More',
  '아직 이 기기에만 있습니다 · 인터넷에 연결되면 자동으로 백업됩니다': 'Only on this device for now · It will be backed up automatically once you’re online',
  '나만 볼 수 있는 개인 공간 · 클라우드에 자동 백업': 'A personal space only you can see · Backed up to the cloud automatically',
  '개인 · 백업 대기': 'Personal · Waiting to back up',
  '템플릿을 열어 승인하거나 거절하세요': 'Open the template to approve or decline',
  '참여 요청 {n}': (v) => plural(v.n, 'request'),
  '{n}명 작업 중': '{n} working now',
  '{when} 수정': 'Edited {when}',
  '소유자': 'Owner',
  '최근 활동': 'Recent activity',
  '전체 보기': 'View all',
  '활동을 불러오지 못했습니다.': 'Couldn’t load activity.',
  '다시 시도': 'Try again',
  '아직 활동이 없습니다.': 'No activity yet.',
  '공간 안내': 'About spaces',
  '나만 볼 수 있음 · 클라우드에 자동 백업 · 여러 기기에서 이어서 작업': 'Only you can see it · Backed up to the cloud automatically · Pick up on any device',
  '초대하면 전환 · 초대한 멤버만 · 실시간 커서·채팅·멤버 관리': 'Created when you invite someone · Invited members only · Live cursors, chat and member management',

  /* Explore · GlobalTimeline */
  '{BRAND} 처음 화면': '{BRAND} home',
  '내 대시보드': 'My dashboard',
  '예시 템플릿 체험하기': 'Try an example template',
  '가입하지 않아도 예시를 열어 직접 고쳐 볼 수 있습니다. 문서를 쓰고, 보드에 그리고, 코드를 실행해 보세요. 바뀐 내용은 저장되지 않으니, 내 작업을 남기려면 가입해 주세요.':
    'Open an example and edit it yourself, no sign-up required. Write a doc, sketch on a board or run some code. Changes aren’t saved, so sign up when you want to keep your work.',
  '내가 참여한 모든 템플릿에서 누가 무엇을 했는지 시간순으로 기록됩니다.': 'See who did what, in order, across every template you’re part of.',

  /* JoinPage */
  '이미 참여한 템플릿입니다': 'You’re already a member of this template',
  '템플릿에 참여했습니다': 'You joined the template',
  '참여하지 못했습니다': 'Couldn’t join',
  '초대 링크를 확인할 수 없습니다': 'We couldn’t verify this invite link',
  '내 공간으로': 'Go to my spaces',
  '사용할 수 없는 초대 링크입니다': 'This invite link can’t be used',
  '초대한 사람에게 새 링크를 요청해 주세요.': 'Ask the person who invited you for a new link.',
  '{name} 님이 초대했습니다': '{name} invited you',
  'Madang은 PC 화면용입니다. 휴대폰에서는 화면이 잘려 보일 수 있으니 이 링크를 {pc}에서 열어 주세요.':
    'Madang is designed for desktop screens and may not display properly on a phone. Please open this link in a {pc}.',
  'PC 브라우저': 'desktop browser',
  '멤버 {n}명': (v) => plural(v.n, 'member'),
  '뷰어 (읽기 전용)로 참여': 'Join as a viewer (read-only)',
  '편집자로 참여': 'Join as an editor',
  '참여 요청이 거절되었거나 템플릿이 삭제되었습니다.': 'Your request was declined, or the template was deleted.',
  '승인을 기다리는 중입니다': 'Waiting for approval',
  '템플릿 멤버가 승인하면 자동으로 열립니다. 이 창을 닫아도 내 공간에서 계속 확인합니다.':
    'The template will open automatically once a member approves. You can close this window; we’ll keep checking from your spaces.',
  '이미 멤버입니다 · 열기': 'You’re already a member · Open',
  '로그인하면 이 템플릿에 참여할 수 있습니다. 처음이라면 인증 후 이름만 정하면 가입이 끝납니다.':
    'Sign in to join this template. If you’re new, just verify your identity and choose a name to finish signing up.',
  '로그인하고 참여하기': 'Sign in and join',
  '참여 요청 보내기': 'Request to join',
  '참여하기': 'Join',
  '이 링크는 멤버의 승인이 필요합니다.': 'A member must approve requests from this link.',

  /* Notices */
  '로그인 화면으로': 'Back to sign-in',
  '공지사항': 'Announcements',
  '{BRAND}의 새 기능, 점검, 정책 변경을 알려 드려요.': 'New features, maintenance and policy updates for {BRAND}.',
  '공지를 불러오지 못했습니다. 잠시 뒤 다시 열어 주세요.': 'Couldn’t load announcements. Please try again in a moment.',
  '아직 공지가 없습니다.': 'No announcements yet.',
  '찾는 공지가 없습니다. 아래 목록에서 골라 주세요.': 'That announcement couldn’t be found. Please choose one from the list below.',

  /* OutageScreen */
  '발생 시각: {at}\n주소: {href}\n오류: {code}\n브라우저: {userAgent}\n\n어떤 상황이었는지 알려 주시면 도움이 됩니다:\n':
    'Time: {at}\nAddress: {href}\nError: {code}\nBrowser: {userAgent}\n\nIt helps if you tell us what you were doing:\n',
  '[Madang 오류] {code}': '[Madang error] {code}',
  '문제가 계속되면 {email}로 알려 주세요.': 'If the problem continues, let us know at {email}.',
  '인터넷에 연결되어 있지 않습니다': 'You’re not connected to the internet',
  '네트워크 연결을 확인해 주세요. 다시 연결되면 자동으로 이어집니다.': 'Check your network connection. We’ll pick up automatically once you’re back online.',
  '서비스에 일시적인 문제가 있습니다': 'We’re having a temporary problem',
  '지금 Madang 서버에 연결할 수 없습니다. 잠시 후 다시 시도해 주세요. 이 화면은 자동으로 다시 연결을 시도합니다.':
    'We can’t reach the Madang servers right now. Please try again shortly. This page will keep trying to reconnect automatically.',
  '서버 응답 {code}': 'Server response {code}',
  '서버 응답 없음': 'No response from server',
  '화면을 불러오지 못했습니다': 'This page couldn’t be loaded',
  '화면을 표시하는 중 오류가 발생했습니다': 'Something went wrong while displaying this page',
  '새 버전이 배포되었거나 연결이 잠시 끊겼습니다. 새로고침하면 대부분 해결됩니다.': 'A new version may have been released, or your connection dropped briefly. Refreshing usually fixes this.',
  '새로고침하면 다시 이어서 쓸 수 있습니다.': 'Refresh the page to pick up where you left off.',
  '새로고침': 'Refresh',

  /* Legal */
  '약관 및 정책': 'Terms and policies',
  '문의 {email}': 'Contact: {email}',
} satisfies Dict;
