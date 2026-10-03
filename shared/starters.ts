/*
 * 언어별 시작 코드 — 새 템플릿의 첫 파일, 그리고 아직 시작 코드 그대로인 파일의 언어를 바꿀 때 쓴다.
 * 안내 문구는 그 언어의 주석 문법으로 쓰므로 그대로 실행해도 오류가 나지 않는다.
 */

const RUN = (name: string) => `함께 코딩해 보세요! 상단의 ▶ 실행 버튼으로 ${name} 코드를 바로 실행할 수 있습니다.`;
const PREVIEW = (what: string) => `함께 코딩해 보세요! 상단의 ▶ 미리보기 버튼으로 ${what}을 바로 볼 수 있습니다.`;
const LOCAL = (name: string) => `${name} 코드는 아직 사이트 안에서 실행할 수 없습니다. 코드를 내려받아 로컬에서 실행해 보세요.`;

const STARTERS: Record<string, string> = {
  javascript: `// ${RUN('JavaScript')}\nconsole.log('Hello, Madang!');\n`,
  typescript: `// ${RUN('TypeScript')}\nconst greet = (name: string): string => \`Hello, \${name}!\`;\nconsole.log(greet('Madang'));\n`,
  jsx: `// ${PREVIEW('React 컴포넌트')}\nexport default function App() {\n  return <h1>Hello, Madang!</h1>;\n}\n`,
  tsx: `// ${PREVIEW('React 컴포넌트')}\nexport default function App({ name = 'Madang' }: { name?: string }) {\n  return <h1>Hello, {name}!</h1>;\n}\n`,
  python: `# ${RUN('Python')}\nprint('Hello, Madang!')\n`,
  sql: `-- ${RUN('SQL')}\nSELECT 'Hello, Madang!' AS greeting;\n`,
  lua: `-- ${RUN('Lua')}\nprint('Hello, Madang!')\n`,
  ruby: `# ${RUN('Ruby')}\nputs 'Hello, Madang!'\n`,
  php: `<?php\n// ${RUN('PHP')}\necho "Hello, Madang!\\n";\n`,
  html: `<!-- ${PREVIEW('화면')} -->\n<h1>Hello, Madang!</h1>\n`,
  css: `/* 함께 꾸며 보세요! HTML 파일이 있으면 상단의 ▶ 미리보기 버튼으로 바로 볼 수 있습니다. */\nbody {\n  font-family: system-ui, sans-serif;\n}\n`,
  scss: `// 함께 꾸며 보세요! 상단의 ▶ CSS로 변환 버튼으로 결과 CSS를 볼 수 있습니다.\n$brand: #6366f1;\n\nh1 {\n  color: $brand;\n}\n`,
  // JSON에는 주석을 쓸 수 없어 안내문 없이 예시만 둔다
  json: `{\n  "message": "Hello, Madang!"\n}\n`,
  yaml: `# 함께 작성해 보세요! 상단의 ▶ 검사 버튼으로 YAML 형식을 확인할 수 있습니다.\nmessage: Hello, Madang!\n`,
  markdown: `# Hello, Madang!\n\n함께 작성해 보세요! 상단의 ▶ 미리보기 버튼으로 바로 볼 수 있습니다.\n`,
  java: `// ${LOCAL('Java')}\npublic class Main {\n  public static void main(String[] args) {\n    System.out.println("Hello, Madang!");\n  }\n}\n`,
  c: `// ${LOCAL('C')}\n#include <stdio.h>\n\nint main(void) {\n  printf("Hello, Madang!\\n");\n  return 0;\n}\n`,
  cpp: `// ${LOCAL('C++')}\n#include <iostream>\n\nint main() {\n  std::cout << "Hello, Madang!" << std::endl;\n  return 0;\n}\n`,
  csharp: `// ${LOCAL('C#')}\nConsole.WriteLine("Hello, Madang!");\n`,
  go: `// ${LOCAL('Go')}\npackage main\n\nimport "fmt"\n\nfunc main() {\n\tfmt.Println("Hello, Madang!")\n}\n`,
  rust: `// ${LOCAL('Rust')}\nfn main() {\n    println!("Hello, Madang!");\n}\n`,
  kotlin: `// ${LOCAL('Kotlin')}\nfun main() {\n    println("Hello, Madang!")\n}\n`,
  swift: `// ${LOCAL('Swift')}\nprint("Hello, Madang!")\n`,
  shell: `#!/usr/bin/env bash\n# ${LOCAL('Shell')}\necho "Hello, Madang!"\n`,
  plaintext: `여기에 자유롭게 적어 보세요.\n`,
};

/** 예전 버전의 시작 코드 (이미 만들어진 템플릿에 남아 있다) */
const LEGACY = ["// 함께 코딩해 보세요! 상단의 ▶ 실행 버튼으로 JavaScript를 바로 실행할 수 있습니다.\nconsole.log('Hello, Madang!');\n"];

export function starterCode(langId: string): string {
  return STARTERS[langId] ?? STARTERS.plaintext;
}

const normalize = (s: string) => s.replace(/\r\n?/g, '\n').trim();
const KNOWN = new Set([...Object.values(STARTERS), ...LEGACY].map(normalize));

/** 사용자가 아직 고치지 않은 시작 코드인지 (빈 파일은 아니다) */
export function isStarterCode(text: string): boolean {
  const t = normalize(text);
  return t !== '' && KNOWN.has(t);
}
