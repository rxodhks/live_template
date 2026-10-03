import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';

/**
 * 큰 Yjs 업데이트(V1)를 maxBytes 안팎의 여러 업데이트로 나눈다.
 *
 * 서버는 4MB가 넘는 메시지를 받지 않는다. 평소 편집은 변경마다 따로 쌓여 나눠 보내지지만,
 * 다시 접속할 때 보내는 "서버에 없는 변경"(오프라인 중 넣은 이미지 여러 장 등)은 한 덩어리라
 * 문서가 상한보다 한참 작아도 413으로 거절되고 화면이 "저장 한도"로 잠겼다.
 *
 *  · 항목(struct) 단위로 자른다 — 항목 하나(이미지 한 장)가 maxBytes보다 크면 그 조각만 크다
 *  · 조각은 순서대로 적용하면 바로 반영된다 (순서가 바뀌어도 Yjs가 앞 조각을 기다렸다가 합친다)
 *  · 삭제 기록은 마지막 조각에 따로 담는다
 */
export function splitUpdate(update: Uint8Array, maxBytes: number): Uint8Array[] {
  if (update.length <= maxBytes) return [update];
  const { structs } = Y.decodeUpdate(update);
  type Struct = (typeof structs)[number];
  type Run = { client: number; clock: number; structs: Struct[] };
  const pieces: Uint8Array[] = [];
  let runs: Run[] = [];
  let size = 0;
  const emit = () => {
    if (!runs.length) return;
    const e = new Y.UpdateEncoderV1();
    encoding.writeVarUint(e.restEncoder, runs.length);
    for (const r of runs) {
      encoding.writeVarUint(e.restEncoder, r.structs.length);
      e.writeClient(r.client);
      encoding.writeVarUint(e.restEncoder, r.clock);
      for (const s of r.structs) s.write(e, 0);
    }
    encoding.writeVarUint(e.restEncoder, 0); // 빈 삭제 기록
    pieces.push(e.toUint8Array());
    runs = [];
    size = 0;
  };
  for (const s of structs) {
    const probe = new Y.UpdateEncoderV1();
    s.write(probe, 0);
    const n = encoding.length(probe.restEncoder) + 12;
    if (size > 0 && size + n > maxBytes) emit();
    const last = runs[runs.length - 1];
    if (last && last.client === s.id.client) last.structs.push(s);
    else runs.push({ client: s.id.client, clock: s.id.clock, structs: [s] });
    size += n;
  }
  emit();
  // 삭제 기록만 남긴 업데이트: 모든 항목의 끝 시각을 상태 벡터로 주면 항목은 모두 걸러진다
  // (encodeStateVectorFromUpdate는 0부터 시작하지 않는 클라이언트를 빼먹어 항목이 다시 실렸다)
  const ends = new Map<number, number>();
  for (const s of structs) ends.set(s.id.client, Math.max(ends.get(s.id.client) ?? 0, s.id.clock + s.length));
  const ds = Y.diffUpdate(update, Y.encodeStateVector(ends));
  if (ds.length > 2) pieces.push(ds);
  return pieces;
}
