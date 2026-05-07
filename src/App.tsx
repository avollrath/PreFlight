import { useEffect, useMemo, useState, type TransitionEvent } from 'react';
import type { ChecklistItem, ChecklistState, PreflightModeState } from './preflight';
import './App.css';

const fallbackItems: ChecklistItem[] = [
  { id: 'water', text: 'Drink water', completed: false },
  { id: 'priorities', text: "Review today's top 3 priorities", completed: false },
  { id: 'calendar', text: 'Check calendar', completed: false },
  { id: 'tasks', text: 'Open task tracker', completed: false },
  { id: 'youtube', text: 'No YouTube before 18:00', completed: false }
];

type DraftChecklistItem = {
  id: string;
  text: string;
};

function createDraftItem(text = ''): DraftChecklistItem {
  return {
    id: crypto.randomUUID(),
    text
  };
}

function toDraftItems(items: Array<Pick<ChecklistItem, 'id' | 'text'>>): DraftChecklistItem[] {
  return items.map((item) => ({ id: item.id, text: item.text }));
}

function App() {
  const [state, setState] = useState<ChecklistState>({
    date: new Date().toISOString().slice(0, 10),
    items: fallbackItems
  });
  const [showSettings, setShowSettings] = useState(false);
  const [settingsVisible, setSettingsVisible] = useState(false);
  const [draftItems, setDraftItems] = useState<DraftChecklistItem[]>(toDraftItems(fallbackItems));
  const [startupEnabled, setStartupEnabled] = useState(false);
  const [blockSecondaryScreens, setBlockSecondaryScreens] = useState(true);
  const [modeState, setModeState] = useState<PreflightModeState>({
    mode: 'edit',
    locked: false,
    strict: true,
    debug: false,
    overlay: true,
    openSettings: true
  });

  useEffect(() => {
    void window.preflight?.getState().then((nextState) => {
      setState(nextState);
      setDraftItems(toDraftItems(nextState.items));
    });
    void window.preflight?.getMode().then((nextMode) => {
      setModeState(nextMode);

      if (nextMode.openSettings) {
        openSettings();
      }
    });
    void window.preflight?.getStartupEnabled().then(setStartupEnabled);
    void window.electronAPI?.getBlockSecondaryScreens().then(setBlockSecondaryScreens);
  }, []);

  useEffect(() => {
    function ignoreStrictDevShortcut(event: KeyboardEvent) {
      if (event.ctrlKey && event.shiftKey && event.key.toLowerCase() === 'u') {
        event.preventDefault();
      }
    }

    window.addEventListener('keydown', ignoreStrictDevShortcut);
    return () => window.removeEventListener('keydown', ignoreStrictDevShortcut);
  }, []);

  useEffect(() => {
    if (!showSettings) {
      return;
    }

    const animationFrame = requestAnimationFrame(() => {
      setSettingsVisible(true);
    });

    return () => cancelAnimationFrame(animationFrame);
  }, [showSettings]);

  useEffect(() => {
    if (modeState.mode !== 'edit') {
      return;
    }

    requestAnimationFrame(() => {
      window.electronAPI?.resizeToContent(document.body.scrollHeight + 40);
    });
  }, [modeState.mode, showSettings, state.items, draftItems]);

  const completedCount = state.items.filter((item) => item.completed).length;
  const isComplete = completedCount === state.items.length;
  const hasProgress = completedCount > 0;
  const isLockedMode = modeState.mode === 'locked';
  const isLockedAndEmpty = isLockedMode && !hasProgress;
  const progressLabel = `${completedCount} / ${state.items.length} complete`;

  const progressWidth = useMemo(() => {
    if (state.items.length === 0) {
      return 0;
    }

    return (completedCount / state.items.length) * 100;
  }, [completedCount, state.items.length]);

  function toggleItem(item: ChecklistItem) {
    const completed = !item.completed;
    setState((current) => ({
      ...current,
      items: current.items.map((currentItem) =>
        currentItem.id === item.id ? { ...currentItem, completed } : currentItem
      )
    }));
    void window.preflight?.setCompletion(item.id, completed).then(setState);
  }

  function unlock() {
    void window.preflight?.unlock().then((unlocked) => {
      if (!unlocked) {
        return;
      }

      setModeState((current) => ({
        ...current,
        mode: 'edit',
        locked: false,
        strict: current.strict,
        openSettings: false
      }));
      closeSettings();
    });
  }

  function ignoreDevUnlock() {
    return;
  }

  function lockNow() {
    closeSettings();
    void window.preflight?.lockNow().then(setModeState);
  }

  function openSettings() {
    setShowSettings(true);
    requestAnimationFrame(() => {
      setSettingsVisible(true);
    });
  }

  function closeSettings() {
    setSettingsVisible(false);
  }

  function finishSettingsClose(event: TransitionEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || settingsVisible) {
      return;
    }

    setShowSettings(false);
  }

  function updateDraftItem(itemId: string, value: string) {
    setDraftItems((current) =>
      current.map((item) => (item.id === itemId ? { ...item, text: value } : item))
    );
  }

  function addDraftItem() {
    setDraftItems((current) => [...current, createDraftItem()]);
  }

  function removeDraftItem(itemId: string) {
    setDraftItems((current) => current.filter((item) => item.id !== itemId));
  }

  function saveSettings() {
    void window.preflight?.saveItems(draftItems.map((item) => item.text)).then((nextState) => {
      setState(nextState);
      setDraftItems(toDraftItems(nextState.items));
      closeSettings();
    });
  }

  function toggleStartup(enabled: boolean) {
    setStartupEnabled(enabled);
    void window.preflight?.setStartupEnabled(enabled).then(setStartupEnabled);
  }

  function toggleBlockSecondaryScreens(enabled: boolean) {
    setBlockSecondaryScreens(enabled);
    void window.electronAPI?.setBlockSecondaryScreens(enabled).then(setBlockSecondaryScreens);
  }

  if (showSettings) {
    return (
      <main className="app-shell settings-shell">
        <section
          className={`settings-view ${settingsVisible ? 'is-visible' : ''}`}
          aria-labelledby="settings-title"
          onTransitionEnd={finishSettingsClose}
        >
          {/* Header: identifies the settings area and provides a clear return action. */}
          <header className="settings-header">
            <div>
              <p className="settings-kicker">Checklist configuration</p>
              <h1 id="settings-title" className="settings-title">
                Settings
              </h1>
              <p className="settings-description">
                Add the tasks you want to complete before you start using your computer.
              </p>
            </div>
            <button
              type="button"
              className="ghost-button settings-close"
              onClick={closeSettings}
            >
              Close
            </button>
          </header>

          {/* Options: startup/wake lock is persisted locally and can be tested in dev. */}
          <label
            className="startup-toggle"
            title="When enabled, PreFlight will automatically lock your screen on system start or wake."
          >
            <input
              type="checkbox"
              checked={startupEnabled}
              onChange={(event) => toggleStartup(event.target.checked)}
            />
            <span>Start PreFlight when Windows starts/wakes up</span>
          </label>

          <label
            className="startup-toggle"
            title="When enabled, PreFlight covers every connected screen during lock mode."
          >
            <input
              id="block-secondary-screens-toggle"
              type="checkbox"
              checked={blockSecondaryScreens}
              onChange={(event) => toggleBlockSecondaryScreens(event.target.checked)}
            />
            <span className="settings-toggle-copy">
              <span>Block all screens when locked</span>
              <span className="settings-toggle-description">
                When off, only your main screen is blocked. Secondary screens stay usable (e.g. for
                Spotify or reference material).
              </span>
            </span>
          </label>

          {/* Checklist editor: stable item IDs keep input focus steady while typing. */}
          <div className="settings-list" aria-label="Editable checklist items">
            {draftItems.map((item, index) => (
              <div className="settings-item" key={item.id}>
                <input
                  value={item.text}
                  aria-label={`Checklist item ${index + 1}`}
                  onChange={(event) => updateDraftItem(item.id, event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.currentTarget.blur();
                    }
                  }}
                />
                <button
                  type="button"
                  className="ghost-button settings-remove"
                  onClick={() => removeDraftItem(item.id)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>

          {/* Footer actions: add new rows on the left, save the checklist on the right. */}
          <footer className="settings-actions">
            <button type="button" className="ghost-button settings-add" onClick={addDraftItem}>
              Add item
            </button>
            <button type="button" className="settings-save" onClick={saveSettings}>
              Save checklist
            </button>
          </footer>
        </section>
      </main>
    );
  }

  return (
    <main className={`app-shell ${modeState.mode === 'edit' ? 'setup-mode' : 'locked-mode'}`}>
      <section className="preflight-panel" aria-labelledby="preflight-title">
        <div className="dashboard-content">
          {!isLockedMode && (
            <div className="top-row">
              <div>
                <div className="eyebrow">Setup mode</div>
                <div className="shortcut-label">
                  Edit your checklist below, then click Lock Now when you're ready to start.
                </div>
              </div>
              <div className="top-actions">
                <button type="button" className="ghost-button" onClick={lockNow}>
                  Lock now
                </button>
                <button type="button" className="ghost-button" onClick={openSettings}>
                  Settings
                </button>
              </div>
            </div>
          )}

          <div className={`scan-bar ${isLockedAndEmpty ? 'is-idle' : ''}`} aria-hidden="true">
            <div className="scan-beam" />
          </div>

          <p className="app-name">PreFlight</p>
          <h1 id="preflight-title">Before you start</h1>
          <p className="lede">
            {modeState.mode === 'edit'
              ? 'Check off every item below to unlock your desktop and get to work.'
              : 'Complete every item to unlock your desktop.'}
          </p>

          <div className="progress-row">
            <span>{progressLabel}</span>
            {!isLockedMode && <span className="editing-badge">Editing</span>}
          </div>

          <div
            className={`progress-track ${hasProgress ? 'has-progress' : ''}`}
            aria-hidden="true"
          >
            <div className="progress-fill" style={{ width: `${progressWidth}%` }} />
          </div>

          <ul className="checklist">
            {state.items.map((item) => (
              <li key={item.id}>
                <label>
                  <input
                    type="checkbox"
                    checked={item.completed}
                    onChange={() => toggleItem(item)}
                  />
                  <span>{item.text}</span>
                </label>
              </li>
            ))}
          </ul>

          <div className="actions">
            <div className="unlock-action">
              <button type="button" disabled={!isComplete} onClick={unlock}>
                Unlock desktop
              </button>
              {!isComplete && (
                <span className="unlock-helper">Complete all items above to unlock</span>
              )}
            </div>
            {!modeState.strict && (
              <button type="button" className="dev-unlock" onClick={ignoreDevUnlock}>
                Dev Unlock Disabled
              </button>
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

export default App;
