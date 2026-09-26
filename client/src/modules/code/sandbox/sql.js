// SQL 실행 (sql.js · SQLite WebAssembly) — 문장마다 결과를 표로 보여 준다
//  payload: { code, setup: [{ name, code }] } — setup은 먼저 실행할 다른 .sql 파일 (스키마 · 샘플 데이터)
async function main({ code, name, setup }) {
  importScripts(fileURL('sql-wasm.js', 'text/javascript'));
  const SQL = await self.initSqlJs({ wasmBinary: FILES['sql-wasm.wasm'] });
  const db = new SQL.Database();
  ready();
  for (const s of setup || []) {
    try {
      db.exec(s.code);
      out('info', '▸ ' + s.name + ' 먼저 실행함');
    } catch (err) {
      out('error', s.name + ': ' + err.message);
      const e = new Error('sql');
      e.__reported = true;
      throw e;
    }
  }
  let n = 0;
  let failed = false;
  for (const stmt of db.iterateStatements(code)) {
    n++;
    const text = stmt.getSQL().trim();
    const short = text.replace(/\s+/g, ' ').slice(0, 80) + (text.length > 80 ? '…' : '');
    try {
      const columns = stmt.getColumnNames();
      const rows = [];
      while (stmt.step()) rows.push(stmt.get());
      if (columns.length) table(columns, rows, short);
      else {
        const changed = db.getRowsModified();
        out('log', '✓ ' + short + (/^\s*(insert|update|delete|replace)/i.test(text) ? '  · ' + changed + '행 변경' : ''));
      }
    } catch (err) {
      out('error', n + '번째 문장에서 오류: ' + err.message + '\n  → ' + short);
      failed = true;
      break;
    } finally {
      stmt.free();
    }
  }
  if (!failed && n === 0) out('info', '실행할 SQL 문장이 없습니다.');
  db.close();
  if (failed) {
    const e = new Error('sql');
    e.__reported = true;
    throw e;
  }
}
