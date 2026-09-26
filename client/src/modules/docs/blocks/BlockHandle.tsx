import { useCallback, useRef, useState } from 'react';
import { DragHandle } from '@tiptap/extension-drag-handle-react';
import type { Editor } from '@tiptap/react';
import type { Node as PMNode } from '@tiptap/pm/model';
import { ArrowDown, ArrowUp, Copy, GripVertical, Palette, Plus, Trash2, Ungroup } from 'lucide-react';
import { cx } from '../../../lib/util';
import { TURN_INTO, turnBlockInto } from './blockDefs';
import { ColorPalette, Popover, applyColor } from './Popover';

interface Target {
  node: PMNode;
  pos: number;
}

const NAMES: Record<string, string> = {
  paragraph: '텍스트',
  heading: '제목',
  bulletList: '글머리 기호 목록',
  orderedList: '번호 목록',
  taskList: '할 일 목록',
  blockquote: '인용',
  callout: '콜아웃',
  details: '토글 목록',
  codeBlock: '코드',
  horizontalRule: '구분선',
  table: '표',
  image: '이미지',
  embed: '임베드',
  columns: '다단',
  tableOfContents: '목차',
  blockMath: '수식',
};

/** 손잡이 위치 — 같은 객체를 써야 한다 (바뀌면 DragHandle이 플러그인을 다시 등록해 손잡이가 사라진다) */
const HANDLE_POSITION = { placement: 'left-start', strategy: 'absolute' } as const;

/** 글 블록 (종류 바꾸기 · 색 넣기가 되는 블록) */
const TEXTUAL = new Set(['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote', 'callout', 'details', 'codeBlock']);

/**
 * 블록 왼쪽 손잡이 (노션처럼)
 *  - + : 아래에 새 블록을 만들고 '/' 메뉴를 연다
 *  - ⋮⋮ : 끌어서 옮기기, 누르면 블록 메뉴 (전환 · 색 · 복제 · 이동 · 삭제)
 */
export function BlockHandle({ editor }: { editor: Editor }) {
  const [target, setTarget] = useState<Target | null>(null);
  const [menu, setMenu] = useState<{ t: Target; rect: DOMRect; colors?: boolean } | null>(null);
  const targetRef = useRef<Target | null>(null);
  targetRef.current = target;

  const onNodeChange = useCallback(({ node, pos }: { node: PMNode | null; pos: number }) => {
    setTarget(node ? { node, pos } : null);
  }, []);

  const add = () => {
    const t = targetRef.current;
    if (!t) return;
    const { node, pos } = t;
    if (node.type.name === 'paragraph' && node.content.size === 0) {
      editor.chain().focus().setTextSelection(pos + 1).insertContent('/').run();
      return;
    }
    const at = pos + node.nodeSize;
    editor.chain().focus().insertContentAt(at, { type: 'paragraph' }).setTextSelection(at + 1).insertContent('/').run();
  };

  const marked = useRef<HTMLElement | null>(null);
  const closeMenu = useCallback(() => {
    setMenu(null);
    marked.current?.classList.remove('is-block-target');
    marked.current = null;
    // 메뉴가 닫히면 손잡이가 다시 마우스를 따라간다
    editor.commands.setMeta('lockDragHandle', false);
  }, [editor]);

  const openMenu = (el: HTMLElement) => {
    const t = targetRef.current;
    if (!t) return;
    editor.commands.setMeta('lockDragHandle', true);
    // 어떤 블록의 메뉴인지 보이도록 표시만 한다 (선택하면 글자가 가려진다)
    const dom = editor.view.nodeDOM(t.pos);
    if (dom instanceof HTMLElement) {
      dom.classList.add('is-block-target');
      marked.current = dom;
    }
    setMenu({ t, rect: el.getBoundingClientRect() });
  };

  return (
    <>
      <DragHandle editor={editor} onNodeChange={onNodeChange} computePositionConfig={HANDLE_POSITION}>
        <div className="block-handle" data-type={target?.node.type.name}>
          <button type="button" className="block-handle-btn" aria-label="아래에 블록 추가" data-tip="누르면 아래에 블록 추가" onClick={add}>
            <Plus size={16} />
          </button>
          <button
            type="button"
            className="block-handle-btn is-grip"
            aria-label="블록 메뉴"
            data-tip="끌어서 옮기기 · 누르면 메뉴"
            onClick={(e) => openMenu(e.currentTarget)}
          >
            <GripVertical size={16} />
          </button>
        </div>
      </DragHandle>
      {menu && <BlockMenu editor={editor} target={menu.t} anchor={menu.rect} onClose={closeMenu} />}
    </>
  );
}

function BlockMenu({ editor, target, anchor, onClose }: { editor: Editor; target: Target; anchor: DOMRect; onClose(): void }) {
  const [colors, setColors] = useState(false);
  // 메뉴를 여는 사이 다른 사람이 문서를 바꿨을 수 있으니 지금 위치의 블록을 다시 확인한다
  const live = (): Target | null => {
    const node = editor.state.doc.nodeAt(target.pos);
    return node && node.type === target.node.type ? { node, pos: target.pos } : null;
  };
  const type = target.node.type.name;
  const textual = TEXTUAL.has(type);
  const range = () => {
    const t = live();
    return t ? { from: t.pos + 1, to: t.pos + t.node.nodeSize - 1 } : null;
  };

  const run = (fn: (t: Target) => void) => {
    const t = live();
    if (t) fn(t);
    onClose();
  };

  const move = (dir: -1 | 1) =>
    run(({ node, pos }) => {
      const $pos = editor.state.doc.resolve(pos);
      const index = $pos.index();
      const parent = $pos.parent;
      const sibling = parent.maybeChild(index + dir);
      if (!sibling) return;
      const tr = editor.state.tr;
      if (dir === -1) {
        tr.delete(pos, pos + node.nodeSize).insert(pos - sibling.nodeSize, node);
      } else {
        tr.delete(pos, pos + node.nodeSize).insert(pos + sibling.nodeSize, node);
      }
      editor.view.dispatch(tr.scrollIntoView());
      editor.commands.focus();
    });

  const $pos = editor.state.doc.resolve(target.pos);
  const canUp = $pos.index() > 0;
  const canDown = $pos.index() < $pos.parent.childCount - 1;
  const current = TURN_INTO.find((b) => {
    if (type === 'heading') return b.key === `h${target.node.attrs.level}`;
    return { paragraph: 'paragraph', bulletList: 'bullet', orderedList: 'ordered', taskList: 'task', blockquote: 'quote', callout: 'callout', details: 'toggle', codeBlock: 'code' }[type] === b.key;
  });

  return (
    <Popover anchor={anchor} onClose={onClose} className="block-menu">
      <div className="popover-title">{type === 'heading' ? `제목 ${target.node.attrs.level}` : (NAMES[type] ?? '블록')}</div>
      {colors ? (
        <>
          <ColorPalette
            editor={editor}
            onPick={(kind, key) => {
              const r = range();
              if (r) applyColor(editor, kind, key, r);
              onClose();
            }}
          />
          <button type="button" className="menu-item" onClick={() => setColors(false)}>
            ← 돌아가기
          </button>
        </>
      ) : (
        <>
          {textual && (
            <>
              <div className="popover-label">전환</div>
              <div className="turn-into-grid">
                {TURN_INTO.map((b) => (
                  <button
                    key={b.key}
                    type="button"
                    className={cx('turn-into-item', current?.key === b.key && 'is-active')}
                    onClick={() => run((t) => turnBlockInto(editor, t.pos, b))}
                  >
                    {b.icon}
                    <span>{b.label}</span>
                  </button>
                ))}
              </div>
              {type !== 'codeBlock' && (
                <button type="button" className="menu-item" onClick={() => setColors(true)}>
                  <Palette size={15} /> 색
                </button>
              )}
              <div className="menu-divider" />
            </>
          )}
          {type === 'columns' && (
            <button type="button" className="menu-item" onClick={() => run((t) => editor.chain().focus().unsetColumns(t.pos).run())}>
              <Ungroup size={15} /> 단 풀기 (위아래로 늘어놓기)
            </button>
          )}
          <button type="button" className="menu-item" onClick={() => run(({ node, pos }) => editor.chain().focus().insertContentAt(pos + node.nodeSize, node.toJSON()).run())}>
            <Copy size={15} /> 복제
          </button>
          <button type="button" className="menu-item" disabled={!canUp} onClick={() => move(-1)}>
            <ArrowUp size={15} /> 위로 이동 <span className="menu-hint">Ctrl+Shift+↑</span>
          </button>
          <button type="button" className="menu-item" disabled={!canDown} onClick={() => move(1)}>
            <ArrowDown size={15} /> 아래로 이동 <span className="menu-hint">Ctrl+Shift+↓</span>
          </button>
          <button type="button" className="menu-item is-danger" onClick={() => run(({ node, pos }) => editor.chain().focus().deleteRange({ from: pos, to: pos + node.nodeSize }).run())}>
            <Trash2 size={15} /> 삭제
          </button>
        </>
      )}
    </Popover>
  );
}
