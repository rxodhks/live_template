import fs from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { marked } from 'marked';
import { parse as parseYaml } from 'yaml';
import type { Notice, NoticeTag } from '../../shared/notices';
import { NOTICE_TAGS } from '../../shared/notices';

/*
 * 공지사항 — 저장소의 notices/*.md 를 빌드할 때 /notices.json 하나로 묶는다.
 *  - 글 머리(--- 사이)에 제목 · 날짜 · 종류 · 배너 여부, 아래는 마크다운 본문
 *  - 마크다운 → HTML 변환은 여기서 끝내므로 화면 코드에는 변환기가 들어가지 않는다
 *  - 날짜가 미래인 글도 파일에는 들어가고, 화면이 그날부터 보여 준다 (예약 게시)
 *  - 형식이 틀리면 빌드를 멈춘다 (잘못된 공지가 그대로 나가지 않게)
 */

const DIR = path.resolve(__dirname, '..', '..', 'notices');
const FILE = 'notices.json';
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/;

function readNotice(file: string): Notice {
  const id = file.replace(/\.md$/, '');
  const fail = (msg: string): never => {
    throw new Error(`공지 notices/${file}: ${msg}`);
  };
  if (!/^[a-z0-9][a-z0-9-]*$/.test(id)) fail('파일 이름은 영어 소문자 · 숫자 · - 만 쓸 수 있습니다');
  const raw = fs.readFileSync(path.join(DIR, file), 'utf8').replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = raw.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!m) fail('맨 위에 --- 로 둘러싼 글 머리(title, date)가 필요합니다');
  const meta = (parseYaml(m![1]) ?? {}) as Record<string, unknown>;
  const body = m![2].trim();
  // yaml은 2026-10-07 을 날짜로 읽을 수 있어 글자로 맞춘다
  const date = meta.date instanceof Date ? meta.date.toISOString().slice(0, 10) : String(meta.date ?? '');
  const until = meta.until instanceof Date ? meta.until.toISOString().slice(0, 10) : meta.until == null ? undefined : String(meta.until);
  const title = String(meta.title ?? '').trim();
  const tag = String(meta.tag ?? '소식') as NoticeTag;
  if (!title) fail('title(제목)이 비어 있습니다');
  if (!DATE.test(date)) fail('date는 2026-10-07 형식이어야 합니다');
  if (until && !DATE.test(until)) fail('until은 2026-10-07 형식이어야 합니다');
  if (!NOTICE_TAGS.includes(tag)) fail(`tag는 ${NOTICE_TAGS.join(' · ')} 중 하나여야 합니다`);
  if (!body) fail('본문이 비어 있습니다');
  const deployAt = meta.deploy_at == null ? undefined : String(meta.deploy_at);
  const deployedAt = meta.deployed_at == null ? undefined : String(meta.deployed_at);
  if (deployAt && !STAMP.test(deployAt)) fail('deploy_at은 2026-10-12 14:00 형식(한국 시간)이어야 합니다');
  if (deployedAt && !STAMP.test(deployedAt)) fail('deployed_at은 2026-10-12 14:00 형식이어야 합니다');
  // 요약: 따로 적지 않으면 본문 첫 문단 (마크다운 기호는 뺀다)
  const firstPara = body.split(/\n\s*\n/)[0].replace(/[*_`#>[\]]|\(https?:[^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  const summary = String(meta.summary ?? firstPara).slice(0, 120);
  return {
    id,
    title,
    // 업데이트를 마치면 그날 올라온 글로 본다 (목록 맨 위 · 새 소식)
    date: deployedAt ? deployedAt.slice(0, 10) : date,
    tag,
    // 예약 업데이트 공지는 따로 적지 않으면 배너로 띄우고, 마친 날까지 둔다
    pin: meta.pin === undefined ? !!deployAt : meta.pin === true,
    until: until ?? (deployedAt ? deployedAt.slice(0, 10) : undefined),
    summary,
    html: marked.parse(body, { async: false }),
    ...(deployAt ? { deployAt } : {}),
    ...(deployedAt ? { deployedAt } : {}),
  };
}

export function readNotices(): Notice[] {
  if (!fs.existsSync(DIR)) return [];
  return fs
    .readdirSync(DIR)
    .filter((f) => f.endsWith('.md') && f.toLowerCase() !== 'readme.md')
    .map(readNotice)
    .sort((a, b) => (a.date === b.date ? b.id.localeCompare(a.id) : b.date.localeCompare(a.date)));
}

export function noticesPlugin(): Plugin {
  return {
    name: 'notices',
    // 개발 서버: 파일을 고치면 바로 보이게 요청마다 다시 읽는다
    configureServer(server) {
      server.watcher.add(DIR);
      server.middlewares.use(`/${FILE}`, (_req, res) => {
        try {
          res.setHeader('content-type', 'application/json; charset=utf-8');
          res.end(JSON.stringify(readNotices()));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: FILE, source: JSON.stringify(readNotices()) });
    },
  };
}
