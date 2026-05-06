import './App.css';

const items = [
  'Drink water',
  "Review today's top 3 priorities",
  'Check calendar',
  'Open task tracker',
  'No YouTube before 18:00'
];

function App() {
  return (
    <main className="app-shell">
      <section className="preflight-panel" aria-labelledby="preflight-title">
        <div className="eyebrow">MVP development mode</div>
        <p className="app-name">PreFlight</p>
        <h1 id="preflight-title">Before you start</h1>
        <p className="lede">Complete your checklist to unlock your desktop.</p>

        <div className="progress-row">
          <span>0 / {items.length} complete</span>
          <span>Locked</span>
        </div>

        <ul className="checklist">
          {items.map((item) => (
            <li key={item}>
              <label>
                <input type="checkbox" />
                <span>{item}</span>
              </label>
            </li>
          ))}
        </ul>

        <div className="actions">
          <button type="button" disabled>
            Unlock desktop
          </button>
          <button type="button" className="dev-unlock">
            Dev Unlock
          </button>
        </div>
      </section>
    </main>
  );
}

export default App;
