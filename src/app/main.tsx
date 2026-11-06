import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { computeGeometry } from '../core/pipeline';
import { toSvg } from '../core/svg';
import { App } from './App';
import { GeometryClient } from './geometry-client';
import { autosave, readAutosave } from './files';
import { drawLog } from './render';
import { startSession } from './session';
import { EditorStore, firstScene } from './store';
import './styles.css';

const params = new URLSearchParams(location.search);
const saved = readAutosave();
const store = new EditorStore(saved.status === 'ok' ? saved.scene : firstScene());
if (saved.status === 'corrupt') {
  store.notify({
    kind: 'error',
    title: 'The saved scene in this browser could not be read, so a starter opened instead.',
  });
}

const session = startSession(store, {
  useWorker: params.get('worker') !== 'off',
  createClient: (events, options) => new GeometryClient(events, options),
  persist: autosave,
});

// Read by end to end tests and the browser benchmark. It gives access to state
// only, and only when the URL asks for it.
if (params.has('hook')) {
  (window as unknown as { __contour: unknown }).__contour = {
    store,
    session,
    drawLog,
    core: { computeGeometry, toSvg },
  };
}

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <App store={store} session={session} />
  </StrictMode>,
);
