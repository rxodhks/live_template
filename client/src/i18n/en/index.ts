/*
 * 영어 사전 — 한국어 화면을 쓰는 사람은 받지 않는다 (i18n/index.ts가 영어 화면일 때만 불러온다).
 * 열쇠는 한국어 원문 그대로, 값은 영어권에서 실제로 쓰는 업무용 문장으로 옮긴다 (직역하지 않는다).
 * 화면 영역마다 파일을 나눴다. 빠진 문구 · 두 번 들어간 문구는 npm run i18n 이 찾는다.
 */
import type { Dict } from '..';
import common from './common';
import auth from './auth';
import components from './components';
import pages from './pages';
import workspace from './workspace';
import design from './design';
import docs from './docs';
import notes from './notes';
import code from './code';
import shared from './shared';
import server from './server';

export { ACTIVITY_EN } from './activity';

export const EN: Dict = { ...common, ...components, ...auth, ...pages, ...workspace, ...design, ...docs, ...notes, ...code, ...shared, ...server };
