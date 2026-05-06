import { useMemo, useState } from 'react';
import './App.css';

const items = [
  'Drink water',
  "Review today's top 3 priorities",
  'Check calendar',
  'Open task tracker',
  'No YouTube before 18:00'
];

function App() {
  const [completedItems, setCompletedItems] = useState<Set<string>>(new Set());
  const completedCount = completedItems.size;
  const isComplete = completedCount === items.length;

  const progressLabel = useMemo(
    () => `${completedCount} / ${items.length} complete`,
    [completedCount]
  );

  function toggleItem(item: string) {
    setCompletedItems((current) => {
      const next = new Set(current);

      if (next.has(item)) {
        next.delete(item);
      } else {
        next.add(item);
      }

      return next;
    });
  }

  function unlock() {
    void window.preflight?.unlock();
  }

  return (
    <main className="app-shell">
      <section className="preflight-panel" aria-labelledby="preflight-title">
        <div className="eyebrow">MVP development mode</div>
        <p className="app-name">PreFlight</p>
        <h1 id="preflight-title">Before you start</h1>
        <p className="lede">Complete your checklist to unlock your desktop.</p>

        <div className="progress-row">
          <span>{progressLabel}</span>
          <span>{isComplete ? 'Ready' : 'Locked'}</span>
        </div>

        <div className="progress-track" aria-hidden="true">
          <div
            className="progress-fill"
            style={{ width: `${(completedCount / items.length) * 100}%` }}
          />
        </div>

        <ul className="checklist">
          {items.map((item) => (
            <li key={item}>
              <label>
                <input
                  type="checkbox"
                  checked={completedItems.has(item)}
                  onChange={() => toggleItem(item)}
                />
                <span>{item}</span>
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
      </section>
    </main>
  );
}

export default App;
