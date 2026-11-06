/** Native dialogs: starters and keyboard shortcuts. */

import { useEffect, useMemo, useRef, type ReactNode } from 'react';
import { computeGeometry } from '../core/pipeline';
import { PRESETS, type Preset } from '../core/presets';
import { emptyScene } from '../core/scene';
import { toSvg } from '../core/svg';
import type { EditorState, EditorStore } from './store';

function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      className="dialog"
      aria-labelledby="dialog-title"
      onClose={onClose}
      onClick={(event) => {
        if (event.target === ref.current) ref.current?.close();
      }}
    >
      <div className="dialog-head">
        <h2 id="dialog-title">{title}</h2>
        <button type="button" className="pill small" onClick={() => ref.current?.close()}>
          Close
        </button>
      </div>
      {children}
    </dialog>
  );
}

function thumbnail(preset: Preset): string {
  const scene = {
    ...preset.scene,
    style: { ...preset.scene.style, strokeWidth: preset.scene.style.strokeWidth * 1.4 },
    export: { ...preset.scene.export, tolerance: 0.5, decimals: 1 },
  };
  const svg = toSvg(computeGeometry(scene, { quality: 'final', resolution: 128 }), scene);
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

function Starters({ store }: { store: EditorStore }) {
  const items = useMemo(
    () => PRESETS.map((preset) => ({ preset, image: thumbnail(preset) })),
    [],
  );
  const close = () => store.set({ dialog: null });
  return (
    <Modal title="Start from" onClose={close}>
      <ul className="starter-list">
        {items.map(({ preset, image }) => (
          <li key={preset.id}>
            <button
              type="button"
              className="starter"
              onClick={() => {
                store.replaceScene(preset.scene);
                close();
              }}
            >
              <img src={image} alt="" />
              <span className="starter-title">{preset.title}</span>
              <span className="starter-summary">{preset.summary}</span>
            </button>
          </li>
        ))}
        <li>
          <button
            type="button"
            className="starter starter-empty"
            onClick={() => {
              store.replaceScene(emptyScene());
              close();
            }}
          >
            <span className="starter-blank" aria-hidden="true" />
            <span className="starter-title">Empty sheet</span>
            <span className="starter-summary">No sources. Undo brings your last scene back.</span>
          </button>
        </li>
      </ul>
    </Modal>
  );
}

const SHORTCUTS: [string, string][] = [
  ['V', 'Select and move'],
  ['P', 'Place a peak'],
  ['R', 'Draw a ridge. Enter finishes, Esc cancels'],
  ['H', 'Pan. Or hold Space and drag'],
  ['Arrows', 'Move the selection 1 unit'],
  ['Shift + Arrows', 'Move the selection 10 units'],
  ['[ and ]', 'Shrink or grow the reach'],
  ['Cmd or Ctrl + D', 'Duplicate the source'],
  ['Backspace', 'Delete the source, or a ridge point'],
  ['Cmd or Ctrl + Z', 'Undo'],
  ['Shift + Cmd or Ctrl + Z', 'Redo'],
  ['1', 'Zoom to the frame'],
  ['+ and -', 'Zoom in or out'],
  ['S', 'Snap to a 10 unit grid. Hold Alt to ignore it'],
  ['N', 'Show the exported nodes'],
  ['G', 'Hide the handles to see only the artwork'],
  ['Cmd or Ctrl + S', 'Save the scene file'],
  ['?', 'This list'],
];

function Shortcuts({ store }: { store: EditorStore }) {
  return (
    <Modal title="Keyboard shortcuts" onClose={() => store.set({ dialog: null })}>
      <dl className="shortcut-list">
        {SHORTCUTS.map(([key, action]) => (
          <div key={key}>
            <dt><kbd>{key}</kbd></dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}

export function Dialogs({ store, state }: { store: EditorStore; state: EditorState }) {
  if (state.dialog === 'starters') return <Starters store={store} />;
  if (state.dialog === 'shortcuts') return <Shortcuts store={store} />;
  return null;
}
