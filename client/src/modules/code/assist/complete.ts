/*
 * 언어별 자동 완성 — 코드 화면에서 그 언어 파일을 열 때만 불러온다
 *  - JS · TS · JSX · TSX: TypeScript 언어 서비스가 아는 이름 (변수 · 함수 · 객체의 속성 · 메서드, 타입 설명 포함)
 *  - HTML · CSS · SCSS · JSX · TSX: Emmet 약어 (! → HTML 기본 구조, ul>li*3, div.box, m10 → margin: 10px; …)
 *  - 파이썬: 키워드 · 내장 함수 · 이 파일의 이름
 *  - 그 밖의 언어: 키워드 · 이 파일에 나온 단어
 *  - 모든 언어: 자주 쓰는 코드 조각 (for, if, 함수 …) — Tab 으로 넣고, Tab 으로 다음 칸으로
 */
import {
  autocompletion,
  completeAnyWord,
  completeFromList,
  ifNotIn,
  snippetCompletion,
  type Completion,
  type CompletionContext,
  type CompletionResult,
  type CompletionSource,
} from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import { EditorState, Prec, type Extension } from '@codemirror/state';
import { canComplete, completeCode, completionDetail } from './assist';
import type { CheckRequest } from './protocol';

/** 지금 파일과 함께 넘길 파일들 (import 를 따라가기 위해) */
export type FilesFor = (state: EditorState) => CheckRequest;

// ── 코드 조각 ──
type Snip = [label: string, template: string, detail: string];
const snip = ([label, template, detail]: Snip): Completion => snippetCompletion(template, { label, detail, type: 'snippet', boost: -1 });

const JS: Snip[] = [
  ['log', 'console.log(${})', '콘솔에 출력'],
  ['for', 'for (let ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}', '정해진 횟수만큼 반복'],
  ['forof', 'for (const ${item} of ${list}) {\n\t${}\n}', '배열의 값마다 반복'],
  ['forin', 'for (const ${key} in ${obj}) {\n\t${}\n}', '객체의 키마다 반복'],
  ['foreach', '${list}.forEach((${item}) => {\n\t${}\n});', '배열의 값마다 함수 실행'],
  ['if', 'if (${condition}) {\n\t${}\n}', '조건문'],
  ['ifelse', 'if (${condition}) {\n\t${}\n} else {\n\t\n}', '조건문 (아니면)'],
  ['while', 'while (${condition}) {\n\t${}\n}', '조건이 참인 동안 반복'],
  ['switch', 'switch (${value}) {\n\tcase ${1}:\n\t\t${}\n\t\tbreak;\n\tdefault:\n\t\tbreak;\n}', '값에 따라 나누기'],
  ['fn', 'function ${name}(${params}) {\n\t${}\n}', '함수'],
  ['afn', 'async function ${name}(${params}) {\n\t${}\n}', '비동기 함수'],
  ['arrow', 'const ${name} = (${params}) => {\n\t${}\n};', '화살표 함수'],
  ['try', 'try {\n\t${}\n} catch (err) {\n\tconsole.error(err);\n}', '오류 잡기'],
  ['class', 'class ${Name} {\n\tconstructor(${params}) {\n\t\t${}\n\t}\n}', '클래스'],
  ['import', "import { ${names} } from '${./module}';", '다른 파일에서 가져오기'],
  ['timeout', 'setTimeout(() => {\n\t${}\n}, ${1000});', '잠시 뒤에 실행'],
  ['fetch', "const res = await fetch('${url}');\nconst data = await res.json();\n${}", '주소에서 JSON 받기'],
];
const TS_EXTRA: Snip[] = [
  ['interface', 'interface ${Name} {\n\t${key}: ${string};\n}', '객체 모양 선언'],
  ['type', 'type ${Name} = ${};', '타입 별칭'],
];
const JSX_EXTRA: Snip[] = [
  ['comp', 'export default function ${App}() {\n\treturn (\n\t\t<div>\n\t\t\t${}\n\t\t</div>\n\t);\n}', 'React 컴포넌트'],
  ['useState', 'const [${value}, ${setValue}] = useState(${});', '상태 만들기'],
  ['useEffect', 'useEffect(() => {\n\t${}\n}, []);', '화면에 나타날 때 실행'],
];
const PY: Snip[] = [
  ['print', 'print(${})', '출력'],
  ['def', 'def ${name}(${params}):\n\t${pass}', '함수'],
  ['for', 'for ${i} in range(${10}):\n\t${pass}', '정해진 횟수만큼 반복'],
  ['forin', 'for ${item} in ${items}:\n\t${pass}', '목록의 값마다 반복'],
  ['if', 'if ${condition}:\n\t${pass}', '조건문'],
  ['ifelse', 'if ${condition}:\n\t${pass}\nelse:\n\t', '조건문 (아니면)'],
  ['while', 'while ${condition}:\n\t${pass}', '조건이 참인 동안 반복'],
  ['class', 'class ${Name}:\n\tdef __init__(self${, params}):\n\t\t${pass}', '클래스'],
  ['try', 'try:\n\t${pass}\nexcept Exception as e:\n\tprint(e)', '오류 잡기'],
  ['with', "with open('${file.txt}', encoding='utf-8') as f:\n\t${text = f.read()}", '파일 열기'],
  ['main', "if __name__ == '__main__':\n\t${main()}", '시작 코드'],
  ['input', '${n} = int(input())', '숫자 한 줄 입력받기'],
  ['inputs', '${a}, ${b} = map(int, input().split())', '숫자 여러 개 입력받기'],
  ['lc', '[${x} for ${x} in ${items}]', '리스트 컴프리헨션'],
];
const PY_WORDS =
  'False None True and as assert async await break class continue def del elif else except finally for from global if import in is lambda nonlocal not or pass raise return try while with yield'.split(' ');
const PY_BUILTINS =
  'abs all any bin bool chr dict dir divmod enumerate filter float format hex id input int isinstance len list map max min next oct open ord pow print range repr reversed round set sorted str sum tuple type zip'.split(' ');

const SQL: Snip[] = [
  ['select', 'SELECT ${*}\nFROM ${table}\nWHERE ${condition};', '데이터 조회'],
  ['insert', 'INSERT INTO ${table} (${columns})\nVALUES (${values});', '데이터 넣기'],
  ['update', 'UPDATE ${table}\nSET ${column} = ${value}\nWHERE ${condition};', '데이터 고치기'],
  ['delete', 'DELETE FROM ${table}\nWHERE ${condition};', '데이터 지우기'],
  ['create', 'CREATE TABLE ${table} (\n\tid INTEGER PRIMARY KEY,\n\t${name} TEXT\n);', '표 만들기'],
  ['join', 'SELECT ${*}\nFROM ${a}\nJOIN ${b} ON ${a}.${id} = ${b}.${a_id};', '두 표 합쳐 조회'],
  ['group', 'SELECT ${column}, COUNT(*)\nFROM ${table}\nGROUP BY ${column};', '묶어서 세기'],
];

/** 그 밖의 언어: [코드 조각, 키워드] */
const OTHERS: Record<string, [Snip[], string]> = {
  java: [
    [
      ['main', 'public class Main {\n\tpublic static void main(String[] args) {\n\t\t${}\n\t}\n}', '시작 코드'],
      ['sout', 'System.out.println(${});', '출력'],
      ['for', 'for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}', '반복'],
      ['if', 'if (${condition}) {\n\t${}\n}', '조건문'],
    ],
    'abstract boolean break byte case catch char class continue default do double else enum extends final finally float for if implements import instanceof int interface long new null package private protected public return short static String super switch this throw throws try void while',
  ],
  c: [
    [
      ['main', '#include <stdio.h>\n\nint main(void) {\n\t${}\n\treturn 0;\n}', '시작 코드'],
      ['printf', 'printf("${%d}\\n", ${value});', '출력'],
      ['for', 'for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}', '반복'],
      ['if', 'if (${condition}) {\n\t${}\n}', '조건문'],
    ],
    'break case char const continue default do double else enum extern float for if int long return short signed sizeof static struct switch typedef unsigned void while include define printf scanf',
  ],
  cpp: [
    [
      ['main', '#include <iostream>\nusing namespace std;\n\nint main() {\n\t${}\n\treturn 0;\n}', '시작 코드'],
      ['cout', 'cout << ${} << endl;', '출력'],
      ['for', 'for (int ${i} = 0; ${i} < ${n}; ${i}++) {\n\t${}\n}', '반복'],
      ['if', 'if (${condition}) {\n\t${}\n}', '조건문'],
    ],
    'auto bool break case catch char class const continue default delete do double else enum false float for if include int long namespace new nullptr private protected public return short static string struct switch template this throw true try typedef using vector void while cout cin endl',
  ],
  csharp: [
    [
      ['cw', 'Console.WriteLine(${});', '출력'],
      ['for', 'for (int ${i} = 0; ${i} < ${n}; ${i}++)\n{\n\t${}\n}', '반복'],
      ['if', 'if (${condition})\n{\n\t${}\n}', '조건문'],
    ],
    'abstract bool break case catch class const continue default do double else enum false float for foreach if int interface namespace new null private protected public return static string struct switch this throw true try using var void while',
  ],
  go: [
    [
      ['main', 'package main\n\nimport "fmt"\n\nfunc main() {\n\t${}\n}', '시작 코드'],
      ['pl', 'fmt.Println(${})', '출력'],
      ['for', 'for ${i} := 0; ${i} < ${n}; ${i}++ {\n\t${}\n}', '반복'],
      ['if', 'if ${condition} {\n\t${}\n}', '조건문'],
      ['func', 'func ${name}(${params}) ${} {\n\t\n}', '함수'],
    ],
    'break case chan const continue default defer else fallthrough for func go goto if import interface map package range return select struct switch type var nil true false',
  ],
  rust: [
    [
      ['main', 'fn main() {\n\t${}\n}', '시작 코드'],
      ['pl', 'println!("{}", ${});', '출력'],
      ['for', 'for ${i} in 0..${n} {\n\t${}\n}', '반복'],
      ['fn', 'fn ${name}(${params}) {\n\t${}\n}', '함수'],
    ],
    'as break const continue crate else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type unsafe use where while String Vec Option Some None Result Ok Err',
  ],
  kotlin: [
    [
      ['main', 'fun main() {\n\t${}\n}', '시작 코드'],
      ['pl', 'println(${})', '출력'],
      ['for', 'for (${i} in 0 until ${n}) {\n\t${}\n}', '반복'],
      ['fun', 'fun ${name}(${params}) {\n\t${}\n}', '함수'],
    ],
    'as break class continue do else false for fun if in interface is null object package return super this throw true try typealias val var when while',
  ],
  swift: [
    [
      ['print', 'print(${})', '출력'],
      ['for', 'for ${i} in 0..<${n} {\n\t${}\n}', '반복'],
      ['func', 'func ${name}(${params}) {\n\t${}\n}', '함수'],
    ],
    'break case class continue default defer do else enum extension false for func guard if import in init let nil protocol return self struct switch true var while',
  ],
  php: [
    [
      ['echo', 'echo ${};', '출력'],
      ['foreach', 'foreach (${$items} as ${$item}) {\n\t${}\n}', '배열 반복'],
      ['for', 'for ($i = 0; $i < ${n}; $i++) {\n\t${}\n}', '반복'],
      ['function', 'function ${name}(${params}) {\n\t${}\n}', '함수'],
    ],
    'array as break case class const continue default do echo else elseif empty foreach for function global if include isset new null private protected public require return static switch this true false while count strlen explode implode',
  ],
  ruby: [
    [
      ['puts', 'puts ${}', '출력'],
      ['each', '${items}.each do |${item}|\n\t${}\nend', '배열 반복'],
      ['times', '${3}.times do |${i}|\n\t${}\nend', '정해진 횟수만큼 반복'],
      ['def', 'def ${name}(${params})\n\t${}\nend', '함수'],
      ['if', 'if ${condition}\n\t${}\nend', '조건문'],
    ],
    'begin break case class def do else elsif end ensure false for if in module next nil not or redo rescue retry return self super then true unless until when while yield puts gets require attr_accessor',
  ],
  lua: [
    [
      ['print', 'print(${})', '출력'],
      ['for', 'for ${i} = 1, ${10} do\n\t${}\nend', '정해진 횟수만큼 반복'],
      ['forin', 'for ${k}, ${v} in ipairs(${t}) do\n\t${}\nend', '목록 반복'],
      ['function', 'function ${name}(${params})\n\t${}\nend', '함수'],
      ['if', 'if ${condition} then\n\t${}\nend', '조건문'],
    ],
    'and break do else elseif end false for function goto if in local nil not or repeat return then true until while ipairs pairs tostring tonumber table string math',
  ],
  shell: [
    [
      ['echo', 'echo "${}"', '출력'],
      ['for', 'for ${i} in ${items}; do\n\t${}\ndone', '반복'],
      ['if', 'if [ ${condition} ]; then\n\t${}\nfi', '조건문'],
    ],
    'if then else elif fi for in do done while case esac function return export local echo read',
  ],
};

const kindType: Record<string, string> = {
  function: 'function',
  'local function': 'function',
  method: 'method',
  property: 'property',
  getter: 'property',
  setter: 'property',
  var: 'variable',
  let: 'variable',
  const: 'constant',
  'local var': 'variable',
  parameter: 'variable',
  class: 'class',
  'local class': 'class',
  interface: 'interface',
  type: 'type',
  enum: 'enum',
  'enum member': 'enum',
  keyword: 'keyword',
  module: 'namespace',
  alias: 'variable',
  string: 'text',
};

/** TypeScript 언어 서비스에게 묻는 자동 완성 */
function tsSource(filesFor: FilesFor): CompletionSource {
  return async (ctx: CompletionContext): Promise<CompletionResult | null> => {
    const word = ctx.matchBefore(/[\w$]+$/);
    const dot = ctx.matchBefore(/\.\s*$/) || ctx.matchBefore(/\?\.$/);
    if (!ctx.explicit && !word && !dot) return null;
    // 문자열 · 주석 안에서는 묻지 않는다 (import 경로 등은 언어 서비스가 따로 처리)
    const node = syntaxTree(ctx.state).resolveInner(ctx.pos, -1);
    if (!ctx.explicit && /Comment/.test(node.name)) return null;
    const req = filesFor(ctx.state);
    let res;
    try {
      res = await completeCode({ ...req, pos: ctx.pos });
    } catch {
      return null;
    }
    if (ctx.aborted || !res.items.length) return null;
    const options: Completion[] = res.items.map((it) => ({
      label: it.label,
      apply: it.insert,
      type: kindType[it.kind] ?? 'variable',
      // 언어 서비스의 정렬 순서(지역 이름 → 속성 → 전역 …)를 살린다
      boost: Math.max(-99, 50 - Number.parseInt(it.sort, 10) * 10),
      info: async () => {
        try {
          const d = await completionDetail({ ...req, pos: ctx.pos, entry: it.label, source: it.source, data: it.data });
          if (!d) return null;
          const el = document.createElement('div');
          el.className = 'cm-completionDoc';
          const sig = el.appendChild(document.createElement('code'));
          sig.textContent = d.detail;
          if (d.doc) el.appendChild(document.createElement('p')).textContent = d.doc;
          return el;
        } catch {
          return null;
        }
      },
    }));
    return { from: res.from, options, validFor: /^[\w$]*$/ };
  };
}

/** Emmet 추천: 이름을 친 약어 그대로 보이게 하고, ‘!’ 는 아래 한국어 기본 구조 추천에 맡긴다 */
function emmetSource(src: CompletionSource): CompletionSource {
  const relabel = (state: EditorState, from: number, to: number, options: readonly Completion[]) =>
    options.map((o) => ({ ...o, label: state.sliceDoc(from, to) || o.label, detail: 'Emmet 펼치기' }));
  return async (ctx) => {
    if (ctx.matchBefore(/!$/)) return null;
    const r = await src(ctx);
    if (!r) return r;
    const update = r.update;
    return {
      ...r,
      options: relabel(ctx.state, r.from, r.to ?? ctx.pos, r.options),
      update: update
        ? (cur, from, to, c2) => {
            const u = update(cur, from, to, c2);
            return u && { ...u, options: relabel(c2.state, u.from, u.to ?? c2.pos, u.options) };
          }
        : undefined,
    };
  };
}

/** 언어 데이터에 추천 소스를 더한다 — 소스는 한 번만 만들어 같은 것을 돌려준다 (매번 새로 만들면 추천이 계속 다시 시작된다) */
function extraSources(...sources: CompletionSource[]): Extension {
  const data = sources.map((autocomplete) => ({ autocomplete }));
  return EditorState.languageData.of(() => data);
}

/** HTML: ‘!’ 만 쳐도 기본 구조를 추천 목록에 보여 준다 */
const htmlBang: CompletionSource = (ctx) => {
  const m = ctx.matchBefore(/!$/);
  if (!m) return null;
  return {
    from: m.from,
    options: [
      snippetCompletion(
        '<!DOCTYPE html>\n<html lang="ko">\n<head>\n\t<meta charset="UTF-8">\n\t<meta name="viewport" content="width=device-width, initial-scale=1.0">\n\t<title>${Document}</title>\n</head>\n<body>\n\t${}\n</body>\n</html>',
        { label: '!', detail: 'HTML 기본 구조', type: 'snippet', boost: 99 },
      ),
    ],
  };
};

const NOT_IN_STRING = ['String', 'TemplateString', 'LineComment', 'BlockComment', 'Comment'];

/** 이 언어의 자동 완성 확장 */
export async function completionFor(lang: string, filesFor: FilesFor): Promise<Extension> {
  const exts: Extension[] = [];
  const ts = canComplete(lang);
  const jsx = lang === 'jsx' || lang === 'tsx';
  const emmetSyntax = jsx ? lang : lang === 'html' || lang === 'css' || lang === 'scss' ? lang : null;

  if (emmetSyntax) {
    const { abbreviationTracker, emmetCompletionSource } = await import('@emmetio/codemirror6-plugin');
    // 높은 우선순위: 추천 목록이 뜨기 전에 바로 Tab 을 눌러도 들여쓰기 대신 약어를 펼친다
    exts.push(
      Prec.high(abbreviationTracker({
        syntax: emmetSyntax as never,
        // 추천 목록에 Emmet 결과를 보여 주고, Tab 으로 펼친다
        autocompleteTab: true,
        previewEnabled: false,
        markTagPairs: false,
      })),
    );
    if (lang === 'html') exts.push(extraSources(htmlBang, emmetSource(emmetCompletionSource)));
    if (ts) {
      // JSX · TSX: TypeScript 추천 + Emmet + 코드 조각
      const snips = [...JS, ...(lang === 'tsx' ? TS_EXTRA : []), ...JSX_EXTRA].map(snip);
      exts.push(autocompletion({ override: [tsSource(filesFor), ifNotIn(NOT_IN_STRING, completeFromList(snips)), emmetSource(emmetCompletionSource)] }));
      return exts;
    }
  }
  if (lang === 'html') {
    return exts;
  }
  if (ts) {
    const snips = [...JS, ...(lang === 'typescript' ? TS_EXTRA : [])].map(snip);
    exts.push(autocompletion({ override: [tsSource(filesFor), ifNotIn(NOT_IN_STRING, completeFromList(snips))] }));
    return exts;
  }
  if (lang === 'python') {
    const { localCompletionSource } = await import('@codemirror/lang-python');
    const words: Completion[] = [
      ...PY_WORDS.map((label) => ({ label, type: 'keyword' })),
      ...PY_BUILTINS.map((label) => ({ label, type: 'function', boost: -2 })),
      ...PY.map(snip),
    ];
    exts.push(autocompletion({ override: [localCompletionSource, ifNotIn(['String', 'Comment', 'FormatString'], completeFromList(words))] }));
    return exts;
  }
  if (lang === 'sql') {
    exts.push(extraSources(completeFromList(SQL.map(snip))));
    return exts;
  }
  if (emmetSyntax) return exts; // CSS · SCSS: 언어 기본 추천(속성 이름 · 값) + Emmet
  const other = OTHERS[lang];
  if (other) {
    const [snips, words] = other;
    const list = [...snips.map(snip), ...words.split(' ').map((label) => ({ label, type: 'keyword' }))];
    exts.push(extraSources(completeFromList(list), completeAnyWord));
    return exts;
  }
  // JSON · YAML · Markdown · 일반 텍스트: 이 파일에 나온 단어만
  if (lang !== 'plaintext' && lang !== 'markdown') exts.push(extraSources(completeAnyWord));
  return exts;
}
