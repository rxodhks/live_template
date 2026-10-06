/// <reference lib="webworker" />
/*
 * 파이썬 검사 · 정렬 워커 — Ruff(웹어셈블리)로 문법 오류와 흔한 실수(정의 안 된 이름, 안 쓰는 import 등)를 찾고 코드를 정렬한다.
 * 코드 화면에서 파이썬 파일을 열 때만 불러온다.
 */
import init, { PositionEncoding, Workspace } from '@astral-sh/ruff-wasm-web';
import wasmUrl from '@astral-sh/ruff-wasm-web/ruff_wasm_bg.wasm?url';
import type { AssistDiagnostic, CheckRequest } from './protocol';

interface RuffDiagnostic {
  code: string | null;
  message: string;
  start_location: { row: number; column: number };
  end_location: { row: number; column: number };
  fix: {
    message: string | null;
    edits: { content: string | null; location: { row: number; column: number }; end_location: { row: number; column: number } }[];
  } | null;
}

let ready: Promise<Workspace> | null = null;
const workspace = () =>
  (ready ??= init({ module_or_path: wasmUrl }).then(
    () =>
      new Workspace(
        {
          'line-length': 100,
          'indent-width': 4,
          // 기본 규칙(문법 · 정의 안 된 이름 · 안 쓰는 import 등). 스타일 잔소리는 넣지 않는다
          lint: { select: ['E4', 'E7', 'E9', 'F'] },
          format: { 'quote-style': 'double' },
        },
        PositionEncoding.Utf16,
      ),
  ));

/** 줄 · 열(1부터) → 글자 위치 */
function offsets(text: string) {
  const starts = [0];
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
  return (row: number, column: number) => Math.min(text.length, (starts[Math.max(0, row - 1)] ?? text.length) + Math.max(0, column - 1));
}

async function check({ name, files }: CheckRequest): Promise<AssistDiagnostic[]> {
  const text = files[name] ?? '';
  const ws = await workspace();
  const at = offsets(text);
  return (ws.check(text) as RuffDiagnostic[]).map((d) => {
    const from = at(d.start_location.row, d.start_location.column);
    return {
      from,
      to: Math.max(from, at(d.end_location.row, d.end_location.column)),
      // 문법 오류(코드 없음)만 오류, 나머지는 경고
      severity: d.code ? 'warning' : 'error',
      message: korean(d.code, d.message),
      source: d.code ? `Ruff ${d.code}` : 'Ruff',
      fixes: d.fix?.edits.length
        ? [
            {
              title: fixTitle(d.code, d.fix.message),
              changes: d.fix.edits.map((e) => ({ from: at(e.location.row, e.location.column), to: at(e.end_location.row, e.end_location.column), insert: e.content ?? '' })),
            },
          ]
        : undefined,
    };
  });
}

/** 자주 나오는 Ruff 메시지는 한국어로 (규칙 번호는 아래에 함께 보인다) */
const KO: Record<string, (names: string[]) => string> = {
  F401: ([n]) => `${n}을(를) 가져왔지만 쓰지 않습니다`,
  F811: ([n]) => `${n}이(가) 쓰이기 전에 다시 정의되었습니다`,
  F821: ([n]) => `정의되지 않은 이름입니다: ${n}`,
  F841: ([n]) => `변수 ${n}에 값을 넣었지만 쓰지 않습니다`,
  F541: () => 'f-문자열에 {} 자리가 없습니다 (f를 빼도 됩니다)',
  F632: () => '값 비교에는 is 대신 == 를 쓰세요',
  E711: () => 'None 과 비교할 때는 == 대신 is 를 쓰세요',
  E712: () => 'True · False 와 == 로 비교하지 말고 조건 그대로 쓰세요',
  E722: () => '어떤 오류든 잡는 except: 는 실수를 숨깁니다. except Exception: 처럼 종류를 적으세요',
  E741: ([n]) => `${n}은(는) 숫자 1 · 0 과 헷갈리기 쉬운 이름입니다 (l · O · I)`,
};
const FIX_KO: Record<string, string> = {
  F401: '안 쓰는 import 지우기',
  F841: '안 쓰는 변수 지우기',
  F541: 'f 빼기',
  F632: '== 로 바꾸기',
  E711: 'is 로 바꾸기',
  E712: '조건 그대로 쓰기',
};
const fixTitle = (code: string | null, message: string | null) => (code && FIX_KO[code]) || message || '고치기';

function korean(code: string | null, message: string): string {
  const ko = code && KO[code];
  if (!ko) return message;
  const names = [...message.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
  return ko(names.map((n) => `'${n}'`));
}

async function format(text: string): Promise<string> {
  return (await workspace()).format(text);
}

self.onmessage = async (e: MessageEvent<{ id: number; req?: CheckRequest; format?: string }>) => {
  const { id, req } = e.data;
  try {
    if (req) self.postMessage({ id, diagnostics: await check(req) });
    else self.postMessage({ id, formatted: await format(e.data.format ?? '') });
  } catch (err) {
    self.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
};
