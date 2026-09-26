import { useEffect, useMemo, useState } from 'react';
import { FileText, Infinity as InfinityIcon, Monitor, Presentation, Printer, RectangleHorizontal, RectangleVertical, Ruler, Smartphone, Tablet } from 'lucide-react';
import { PAGE_UNITS, type PageSetup, type PageUnit } from '@shared/schema';
import { Button, Field, Modal } from '../../../components/ui';
import { cx } from '../../../lib/util';
import { ALL_PRESETS, PAGE_CATEGORIES, UNIT_NAMES, convert, describePage, setupFromPreset, toPx } from './pageSizes';

/*
 * 새 문서 · 페이지 설정 창 — 형식(A4 · iPhone · 슬라이드 …)을 고르거나 크기를 직접 입력한다
 * 결과: page가 null이면 자유 형식(끝없이 이어지는 문서)
 */

export interface PageSetupResult {
  page: PageSetup | null;
  title: string;
}

interface Request {
  mode: 'create' | 'edit';
  initial: PageSetup | null;
  title?: string;
  resolve: (r: PageSetupResult | null) => void;
}

let push: ((r: Request) => void) | null = null;

const LAST_KEY = 'lt.doc.lastPage';

/** 마지막으로 고른 형식 (새 문서 창에서 처음 골라져 있는 값) */
export function lastPageSetup(): PageSetup | null {
  try {
    const raw = localStorage.getItem(LAST_KEY);
    return raw ? (JSON.parse(raw) as PageSetup | null) : null;
  } catch {
    return null;
  }
}

export function pageSetupDialog(opts: { mode: 'create' | 'edit'; initial: PageSetup | null; title?: string }): Promise<PageSetupResult | null> {
  return new Promise((resolve) => {
    if (!push) return resolve({ page: opts.initial, title: opts.title ?? '' });
    push({ ...opts, resolve });
  });
}

export function PageSetupHost() {
  const [req, setReq] = useState<Request | null>(null);
  useEffect(() => {
    push = setReq;
    return () => {
      push = null;
    };
  }, []);
  if (!req) return null;
  return (
    <PageSetupDialog
      key={Date.now()}
      req={req}
      onDone={(r) => {
        req.resolve(r);
        setReq(null);
      }}
    />
  );
}

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  free: <InfinityIcon size={16} />,
  print: <Printer size={16} />,
  mobile: <Smartphone size={16} />,
  tablet: <Tablet size={16} />,
  desktop: <Monitor size={16} />,
  slides: <Presentation size={16} />,
  custom: <Ruler size={16} />,
};

const DEFAULT_CUSTOM: PageSetup = { preset: 'custom', width: 800, height: 1000, unit: 'px', margin: 40, fontSize: 16 };

function categoryOf(page: PageSetup | null): string {
  if (!page) return 'free';
  return PAGE_CATEGORIES.find((c) => c.presets.some((p) => p.id === page.preset))?.id ?? 'custom';
}

function PageSetupDialog({ req, onDone }: { req: Request; onDone(r: PageSetupResult | null): void }) {
  const [page, setPage] = useState<PageSetup | null>(req.initial);
  const [category, setCategory] = useState(() => categoryOf(req.initial));
  const [title, setTitle] = useState(req.title ?? '');
  // 입력 중인 숫자 (빈 칸 · 소수점 입력 중에도 되돌아가지 않게)
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const px = page ? { w: toPx(page.width, page.unit), h: toPx(page.height, page.unit), m: toPx(page.margin, page.unit) } : null;
  const error = useMemo(() => {
    if (!page || !px) return null;
    if (px.w < 120 || px.h < 120) return '너비 · 높이는 120px(약 32mm) 이상이어야 합니다.';
    if (px.w > 8000 || px.h > 8000) return '너비 · 높이는 8000px(약 2.1m)까지 정할 수 있습니다.';
    if (px.m * 2 >= Math.min(px.w, px.h) - 40) return '여백이 너무 큽니다.';
    if (page.fontSize < 8 || page.fontSize > 96) return '글자 크기는 8 ~ 96px 사이로 정해 주세요.';
    return null;
  }, [page, px]);

  const pick = (next: PageSetup | null, cat = categoryOf(next)) => {
    setPage(next);
    setCategory(cat);
    setDrafts({});
  };

  /** 크기를 직접 고치면 '직접 입력'으로 */
  const edit = (patch: Partial<PageSetup>) => {
    if (!page) return;
    const next = { ...page, ...patch };
    const preset = ALL_PRESETS.find((p) => p.id === page.preset);
    const stillPreset =
      preset &&
      next.unit === preset.unit &&
      [next.width, next.height].sort((a, b) => a - b).join() === [preset.width, preset.height].sort((a, b) => a - b).join();
    setPage({ ...next, preset: stillPreset ? page.preset : 'custom' });
    if (!stillPreset && ('width' in patch || 'height' in patch)) setCategory('custom');
  };

  const numField = (key: 'width' | 'height' | 'margin' | 'fontSize', label: string, suffix: string) => (
    <label className="ps-num">
      <span>{label}</span>
      <span className="ps-num-input">
        <input
          className="input"
          inputMode="decimal"
          aria-label={label}
          value={drafts[key] ?? String(page?.[key] ?? '')}
          onChange={(e) => {
            const v = e.target.value.replace(',', '.');
            setDrafts((d) => ({ ...d, [key]: v }));
            const n = Number(v);
            if (v.trim() && Number.isFinite(n) && n >= 0) edit({ [key]: n });
          }}
          onBlur={() =>
            setDrafts((d) => {
              const next = { ...d };
              delete next[key];
              return next;
            })
          }
        />
        <em>{suffix}</em>
      </span>
    </label>
  );

  const submit = () => {
    if (error) return;
    try {
      localStorage.setItem(LAST_KEY, JSON.stringify(page));
    } catch {
      /* 무시 */
    }
    onDone({ page, title: title.trim() });
  };

  const cat = PAGE_CATEGORIES.find((c) => c.id === category);
  return (
    <Modal
      title={req.mode === 'create' ? '새 문서' : '페이지 설정'}
      description={req.mode === 'create' ? '문서 크기를 고르세요. 만든 뒤에도 페이지 설정에서 바꿀 수 있습니다.' : '바꾸면 이 문서를 보는 모든 사람에게 적용됩니다. 내용은 그대로입니다.'}
      icon={<FileText size={18} />}
      width={900}
      onClose={() => onDone(null)}
      footer={
        <>
          <span className="ps-summary">{describePage(page)}</span>
          <Button variant="ghost" onClick={() => onDone(null)}>
            취소
          </Button>
          <Button variant="primary" onClick={submit} disabled={!!error}>
            {req.mode === 'create' ? '만들기' : '적용'}
          </Button>
        </>
      }
    >
      <div className="page-setup">
        <nav className="ps-cats" aria-label="문서 종류">
          <button type="button" className={cx('ps-cat', category === 'free' && 'is-active')} onClick={() => pick(null, 'free')}>
            {CATEGORY_ICONS.free} 자유 형식
          </button>
          {PAGE_CATEGORIES.map((c) => (
            <button
              key={c.id}
              type="button"
              className={cx('ps-cat', category === c.id && 'is-active')}
              onClick={() => {
                setCategory(c.id);
                if (categoryOf(page) !== c.id) pick(setupFromPreset(c.presets[0]), c.id);
              }}
            >
              {CATEGORY_ICONS[c.id]} {c.name}
            </button>
          ))}
          <button
            type="button"
            className={cx('ps-cat', category === 'custom' && 'is-active')}
            onClick={() => {
              setCategory('custom');
              if (!page) setPage(DEFAULT_CUSTOM);
              else setPage({ ...page, preset: 'custom' });
            }}
          >
            {CATEGORY_ICONS.custom} 직접 입력
          </button>
        </nav>

        <div className="ps-main">
          {category === 'free' ? (
            <div className="ps-free">
              <InfinityIcon size={30} />
              <b>자유 형식</b>
              <p>종이 크기 없이 아래로 끝없이 이어지는 문서입니다. 메모 · 회의록 · 위키처럼 화면에서 읽고 쓰는 문서에 알맞습니다.</p>
            </div>
          ) : category === 'custom' ? (
            <div className="ps-free">
              <Ruler size={30} />
              <b>직접 입력</b>
              <p>오른쪽에서 너비 · 높이와 단위(px · mm · cm · in · pt)를 정하세요. 인쇄용이면 mm · in, 화면용이면 px가 편합니다.</p>
            </div>
          ) : (
            <>
              <p className="ps-hint">{cat?.hint}</p>
              <div className="ps-grid">
                {cat?.presets.map((p) => {
                  const sel = page?.preset === p.id;
                  const [w, h] = p.landscape ? [Math.max(p.width, p.height), Math.min(p.width, p.height)] : [p.width, p.height];
                  const scale = 54 / Math.max(w, h);
                  return (
                    <button key={p.id} type="button" className={cx('ps-card', sel && 'is-selected')} onClick={() => pick(setupFromPreset(p), category)}>
                      <span className="ps-thumb">
                        <span style={{ width: Math.max(8, w * scale), height: Math.max(8, h * scale) }} />
                      </span>
                      <b>{p.name}</b>
                      <small>
                        {w} × {h} {p.unit}
                      </small>
                      {p.note && <small className="muted">{p.note}</small>}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>

        <aside className="ps-side">
          {req.mode === 'create' && (
            <Field label="문서 이름">
              <input className="input" value={title} placeholder="제목 없는 문서" maxLength={80} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && !e.nativeEvent.isComposing && submit()} />
            </Field>
          )}
          <PagePreview page={page} />
          {page && (
            <>
              <div className="ps-row">
                {numField('width', '너비', page.unit)}
                {numField('height', '높이', page.unit)}
              </div>
              <div className="ps-row">
                <label className="ps-num">
                  <span>단위</span>
                  <select
                    className="input"
                    aria-label="단위"
                    value={page.unit}
                    onChange={(e) => {
                      const unit = e.target.value as PageUnit;
                      setDrafts({});
                      setPage({
                        ...page,
                        unit,
                        width: convert(page.width, page.unit, unit),
                        height: convert(page.height, page.unit, unit),
                        margin: convert(page.margin, page.unit, unit),
                      });
                    }}
                  >
                    {PAGE_UNITS.map((u) => (
                      <option key={u} value={u}>
                        {UNIT_NAMES[u]}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="ps-num">
                  <span>방향</span>
                  <div className="ps-orient" role="radiogroup" aria-label="방향">
                    <button
                      type="button"
                      role="radio"
                      aria-checked={page.width <= page.height}
                      aria-label="세로"
                      data-tip="세로"
                      className={cx(page.width <= page.height && 'is-active')}
                      onClick={() => page.width > page.height && setPage({ ...page, width: page.height, height: page.width })}
                    >
                      <RectangleVertical size={16} />
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={page.width > page.height}
                      aria-label="가로"
                      data-tip="가로"
                      className={cx(page.width > page.height && 'is-active')}
                      onClick={() => page.width < page.height && setPage({ ...page, width: page.height, height: page.width })}
                    >
                      <RectangleHorizontal size={16} />
                    </button>
                  </div>
                </div>
              </div>
              <div className="ps-row">
                {numField('margin', '여백', page.unit)}
                {numField('fontSize', '글자 크기', 'px')}
              </div>
              {page.unit !== 'px' && px && (
                <p className="muted small">
                  화면 크기 {Math.round(px.w)} × {Math.round(px.h)} px (96dpi)
                </p>
              )}
            </>
          )}
          {error && <p className="field-error">{error}</p>}
        </aside>
      </div>
    </Modal>
  );
}

/** 비율대로 줄인 미리보기 (여백 · 글줄) */
function PagePreview({ page }: { page: PageSetup | null }) {
  if (!page) {
    return (
      <div className="ps-preview">
        <span className="ps-sheet is-free" style={{ width: 110, height: 150 }}>
          {Array.from({ length: 9 }, (_, i) => (
            <i key={i} style={{ width: `${[70, 90, 80, 60, 88, 75, 92, 66, 84][i]}%` }} />
          ))}
        </span>
      </div>
    );
  }
  const w = toPx(page.width, page.unit);
  const h = toPx(page.height, page.unit);
  const m = toPx(page.margin, page.unit);
  const s = Math.min(170 / w, 150 / h);
  const lines = Math.max(2, Math.min(14, Math.floor((h - 2 * m) / (page.fontSize * 2.4))));
  return (
    <div className="ps-preview">
      <span className="ps-sheet" style={{ width: w * s, height: h * s, padding: Math.max(2, m * s) }}>
        {Array.from({ length: lines }, (_, i) => (
          <i key={i} style={{ width: `${[70, 90, 80, 60, 88, 75, 92, 66, 84][i % 9]}%`, height: Math.max(1.5, page.fontSize * s * 0.55) }} />
        ))}
      </span>
      <small>{describePage(page)}</small>
    </div>
  );
}
