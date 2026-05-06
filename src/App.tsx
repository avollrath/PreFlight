import { useEffect, useMemo, useState } from 'react';
import type { ChecklistItem, ChecklistState } from './preflight';
import './App.css';

const fallbackItems: ChecklistItem[] = [
  { id: 'water', text: 'Drink water', completed: false },
  { id: 'priorities', text: "Review today's top 3 priorities", completed: false },
  { id: 'calendar', text: 'Check calendar', completed: false },
  { id: 'tasks', text: 'Open task tracker', completed: false },
  { id: 'youtube', text: 'No YouTube before 18:00', completed: false }
];

function App() {
  const [state, setState] = useState<ChecklistState>({
    date: new Date().toISOString().slice(0, 10),
    items: fallbackItems
  });
  const [showSettings, setShowSettings] = useState(false);
  const [draftItems, setDraftItems] = useState(fallbackItems.map((item) => item.text));

  useEffect(() => {
    void window.preflight?.getState().then((nextState) => {
      setState(nextState);
      setDraftItems(nextState.items.map((item) => item.text));
    });
  }, []);

  const completedCount = state.items.filter((item) => item.completed).length;
  const isComplete = completedCount === state.items.length;
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
    void window.preflight?.unlock();
  }

  function updateDraftItem(index: number, value: string) {
    setDraftItems((current) =>
      current.map((item, currentIndex) => (currentIndex === index ? value : item))
    );
  }

  function addDraftItem() {
    setDraftItems((current) => [...current, '']);
  }

  function removeDraftItem(index: number) {
    setDraftItems((current) => current.filter((_item, currentIndex) => currentIndex !== index));
  }

  function saveSettings() {
    void window.preflight?.saveItems(draftItems).then((nextState) => {
      setState(nextState);
      setDraftItems(nextState.items.map((item) => item.text));
      setShowSettings(false);
    });
  }

  return (
    <main className="app-shell">
      <section className="preflight-panel" aria-labelledby="preflight-title">
        <div className="top-row">
          <div className="eyebrow">MVP development mode</div>
          <button type="button" className="ghost-button" onClick={() => setShowSettings(true)}>
            Settings
          </button>
        </div>

        <p className="app-name">PreFlight</p>
        <h1 id="preflight-title">Before you start</h1>
        <p className="lede">Complete your checklist to unlock your desktop.</p>

        <div className="progress-row">
          <span>{progressLabel}</span>
          <span>{isComplete ? 'Ready' : 'Locked'}</span>
        </div>

        <div className="progress-track" aria-hidden="true">
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
          <button type="button" disabled={!isComplete} onClick={unlock}>
            Unlock desktop
          </button>
          <button type="button" className="dev-unlock" onClick={unlock}>
            Dev Unlock
          </button>
        </div>

        {showSettings && (
          <div className="settings-backdrop" role="presentation">
            <section className="settings-panel" aria-label="Checklist settings">
              <div className="settings-header">
                <div>
                  <p className="settings-kicker">Local checklist</p>
                  <h2>Settings</h2>
                </div>
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => setShowSettings(false)}
                >
                  Close
                </button>
              </div>

              <div className="settings-list">
                {draftItems.map((item, index) => (
                  <div className="settings-item" key={`${index}-${item}`}>
                    <input
                      value={item}
                      aria-label={`Checklist item ${index + 1}`}
                      onChange={(event) => updateDraftItem(index, event.target.value)}
                    />
                    <button type="button" className="ghost-button" onClick={() => removeDraftItem(index)}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>

              <div className="settings-actions">
                <button type="button" className="ghost-button" onClick={addDraftItem}>
                  Add item
                </button>
                <button type="button" onClick={saveSettings}>
                  Save checklist
                </button>
              </div>
            </section>
          </div>
        )}
      </section>
    </main>
  );
}

export default App;
