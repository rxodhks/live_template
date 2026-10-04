/*
 * 큰 문서 변경 나누기(splitUpdate): 나눈 조각을 차례로 적용한 결과가 원래 변경을 한 번에 적용한 것과 같은지
 * 실행: npm test -w worker
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';
import { splitUpdate } from '../../client/src/lib/ysplit.ts';

/** 글자 · 서식 · XML 요소 · 맵 · 배열 · 삭제가 섞인 문서를 무작위로 만든다 */
function randomEdits(doc: Y.Doc, rnd: () => number, n: number) {
  const text = doc.getText('t');
  const map = doc.getMap('m');
  const arr = doc.getArray('a');
  const frag = doc.getXmlFragment('x');
  for (let i = 0; i < n; i++) {
    const r = rnd();
    doc.transact(() => {
      if (r < 0.3) text.insert(Math.floor(rnd() * (text.length + 1)), 'abc한글'.repeat(1 + Math.floor(rnd() * 5)), rnd() < 0.3 ? { bold: true } : undefined);
      else if (r < 0.4 && text.length > 3) text.delete(Math.floor(rnd() * (text.length - 2)), 2);
      else if (r < 0.55) map.set('k' + Math.floor(rnd() * 20), rnd() < 0.5 ? 'v'.repeat(Math.floor(rnd() * 400)) : { n: rnd(), list: [1, 2, 3] });
      else if (r < 0.6) map.delete('k' + Math.floor(rnd() * 20));
      else if (r < 0.75) arr.insert(Math.floor(rnd() * (arr.length + 1)), [rnd(), 'x'.repeat(Math.floor(rnd() * 200)), new Uint8Array([1, 2, 3])]);
      else if (r < 0.8 && arr.length) arr.delete(Math.floor(rnd() * arr.length), 1);
      else {
        const el = new Y.XmlElement('image');
        el.setAttribute('src', 'data:image/png;base64,' + 'A'.repeat(Math.floor(rnd() * 3000)));
        const p = new Y.XmlElement('paragraph');
        p.insert(0, [new Y.XmlText('문단 ' + i)]);
        frag.insert(Math.floor(rnd() * (frag.length + 1)), [el, p]);
        if (rnd() < 0.2 && frag.length > 2) frag.delete(0, 1);
      }
    });
  }
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

// 맵의 키 순서는 받은 순서라 문서마다 다를 수 있어 정렬해서 비교한다
const state = (d: Y.Doc) =>
  JSON.stringify({ t: d.getText('t').toDelta(), m: Object.entries(d.getMap('m').toJSON()).sort(([a], [b]) => (a < b ? -1 : 1)), a: d.getArray('a').toJSON(), x: d.getXmlFragment('x').toString() });

describe('splitUpdate', () => {
  it('작은 변경은 그대로 돌려준다', () => {
    const d = new Y.Doc();
    d.getText('t').insert(0, 'hi');
    const u = Y.encodeStateAsUpdate(d);
    assert.deepEqual(splitUpdate(u, 1000), [u]);
  });

  for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
    it(`서버에 있는 상태 + 나눈 조각 = 원래 변경 (seed ${seed})`, () => {
      const rnd = seeded(seed);
      const local = new Y.Doc();
      randomEdits(local, rnd, 40);
      // 서버: 여기까지만 가진 상태
      const server = new Y.Doc();
      Y.applyUpdate(server, Y.encodeStateAsUpdate(local));
      // 로컬만 오프라인으로 더 편집 (다른 사용자의 편집도 섞는다)
      const other = new Y.Doc();
      Y.applyUpdate(other, Y.encodeStateAsUpdate(local));
      randomEdits(local, rnd, 60);
      randomEdits(other, rnd, 20);
      Y.applyUpdate(local, Y.encodeStateAsUpdate(other, Y.encodeStateVector(local)));
      const diff = Y.encodeStateAsUpdate(local, Y.encodeStateVector(server));
      const max = 200 + Math.floor(rnd() * 2000);
      const pieces = splitUpdate(diff, max);
      assert.ok(pieces.length > 1, '나뉘어야 한다');
      const a = new Y.Doc();
      Y.applyUpdate(a, Y.encodeStateAsUpdate(server));
      for (const p of pieces) Y.applyUpdate(a, p);
      assert.equal(state(a), state(local));
      assert.deepEqual(Y.encodeStateVector(a), Y.encodeStateVector(local));
      // 순서가 바뀌어 도착해도 결국 같다
      const b = new Y.Doc();
      Y.applyUpdate(b, Y.encodeStateAsUpdate(server));
      for (const p of [...pieces].reverse()) Y.applyUpdate(b, p);
      assert.equal(state(b), state(local));
      // 상한을 넘는 조각은 (더 나눌 수 없는) 항목 하나뿐이거나 삭제 기록뿐이다
      for (const p of pieces.filter((p) => p.length > max)) {
        const { structs } = Y.decodeUpdate(p);
        assert.ok(structs.length <= 1, `조각 ${p.length}B > ${max}B 인데 항목이 ${structs.length}개`);
      }
    });
  }

  it('이미지처럼 큰 항목이 여러 개면 항목 단위로 나뉜다', () => {
    const d = new Y.Doc();
    const frag = d.getXmlFragment('x');
    const server = Y.encodeStateVector(d);
    for (let i = 0; i < 6; i++) {
      const el = new Y.XmlElement('image');
      el.setAttribute('src', 'data:image/jpeg;base64,' + String.fromCharCode(65 + i).repeat(600_000));
      frag.insert(frag.length, [el]);
    }
    const diff = Y.encodeStateAsUpdate(d, server);
    assert.ok(diff.length > 3_000_000);
    const pieces = splitUpdate(diff, 2_500_000);
    assert.ok(pieces.every((p) => p.length <= 2_500_000));
    const a = new Y.Doc();
    for (const p of pieces) Y.applyUpdate(a, p);
    assert.equal(a.getXmlFragment('x').toString(), frag.toString());
  });
});
