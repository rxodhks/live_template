import { useState } from 'react';
import { BubbleMenu } from '@tiptap/react/menus';
import { useEditorState, type Editor } from '@tiptap/react';
import { NodeSelection } from '@tiptap/pm/state';
import { Baseline, Bold, ChevronDown, Code, Italic, Link2, Radical, Strikethrough, Underline } from 'lucide-react';
import { IconButton, promptDialog } from '../../../components/ui';
import { cx } from '../../../lib/util';
import { TURN_INTO, blockLabel, turnSelectionInto } from './blockDefs';
import { ColorPalette, Popover, applyColor } from './Popover';

/** 글자를 선택하면 위에 뜨는 서식 막대 (노션처럼) */
export function BubbleToolbar({ editor }: { editor: Editor }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: e }) =>
      e.isDestroyed
        ? null
        : {
            label: blockLabel(e),
            bold: e.isActive('bold'),
            italic: e.isActive('italic'),
            underline: e.isActive('underline'),
            strike: e.isActive('strike'),
            code: e.isActive('code'),
            link: e.isActive('link'),
          },
  });
  const [pop, setPop] = useState<{ kind: 'turn' | 'color'; rect: DOMRect } | null>(null);
  if (!s) return null;
  const chain = () => editor.chain().focus();

  const setLink = async () => {
    const prev = editor.getAttributes('link').href as string | undefined;
    const url = await promptDialog({ title: '링크', label: 'URL (비우면 링크 제거)', initial: prev ?? 'https://', confirmText: '적용' });
    if (url === null) return;
    if (!url || url === 'https://') chain().extendMarkRange('link').unsetLink().run();
    else chain().extendMarkRange('link').setLink({ href: url }).run();
  };

  const toMath = () => {
    const { from, to } = editor.state.selection;
    const latex = editor.state.doc.textBetween(from, to, ' ').trim();
    if (latex) chain().deleteRange({ from, to }).insertInlineMath({ latex }).run();
  };

  return (
    <>
      <BubbleMenu
        editor={editor}
        className="bubble-toolbar"
        // 배율로 줄인 페이지 안에 들어가면 막대도 작아지므로 화면 맨 위에 띄운다
        appendTo={() => document.body}
        options={{ strategy: 'fixed', placement: 'top', offset: 8, flip: true, shift: { padding: 8 } }}
        shouldShow={({ editor: e, state, from, to }) =>
          e.isEditable && from !== to && !(state.selection instanceof NodeSelection) && !e.isActive('codeBlock') && !e.isActive('image')
        }
      >
        <button type="button" className="bubble-turn" onMouseDown={(e) => e.preventDefault()} onClick={(e) => setPop({ kind: 'turn', rect: e.currentTarget.getBoundingClientRect() })}>
          {s.label} <ChevronDown size={13} />
        </button>
        <span className="tb-sep" />
        <IconButton label="굵게 (Ctrl+B)" size="sm" active={s.bold} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().toggleBold().run()}>
          <Bold size={15} />
        </IconButton>
        <IconButton label="기울임 (Ctrl+I)" size="sm" active={s.italic} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().toggleItalic().run()}>
          <Italic size={15} />
        </IconButton>
        <IconButton label="밑줄 (Ctrl+U)" size="sm" active={s.underline} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().toggleUnderline().run()}>
          <Underline size={15} />
        </IconButton>
        <IconButton label="취소선" size="sm" active={s.strike} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().toggleStrike().run()}>
          <Strikethrough size={15} />
        </IconButton>
        <IconButton label="인라인 코드" size="sm" active={s.code} onMouseDown={(e) => e.preventDefault()} onClick={() => chain().toggleCode().run()}>
          <Code size={15} />
        </IconButton>
        <IconButton label="링크" size="sm" active={s.link} onMouseDown={(e) => e.preventDefault()} onClick={setLink}>
          <Link2 size={15} />
        </IconButton>
        <IconButton label="수식으로 바꾸기" size="sm" onMouseDown={(e) => e.preventDefault()} onClick={toMath}>
          <Radical size={15} />
        </IconButton>
        <span className="tb-sep" />
        <IconButton
          label="글자 색 · 배경 색"
          size="sm"
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => setPop({ kind: 'color', rect: e.currentTarget.getBoundingClientRect() })}
        >
          <Baseline size={15} />
        </IconButton>
      </BubbleMenu>
      {pop && (
        <Popover anchor={pop.rect} side="bottom" onClose={() => setPop(null)} className={cx(pop.kind === 'turn' ? 'turn-menu' : 'color-menu')}>
          {pop.kind === 'turn' ? (
            <>
              <div className="popover-label">전환</div>
              {TURN_INTO.map((b) => (
                <button
                  key={b.key}
                  type="button"
                  className={cx('menu-item', b.isActive?.(editor) && b.key !== 'paragraph' && 'is-active')}
                  onClick={() => {
                    turnSelectionInto(editor, b);
                    setPop(null);
                  }}
                >
                  {b.icon} {b.label}
                </button>
              ))}
            </>
          ) : (
            <ColorPalette
              editor={editor}
              onPick={(kind, key) => {
                applyColor(editor, kind, key);
                setPop(null);
              }}
            />
          )}
        </Popover>
      )}
    </>
  );
}
