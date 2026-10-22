import { createAppContext } from './app/context';
import { createSampleProject } from './app/sample';
import { loadInitialProject } from './io';
import { mountApp } from './ui/shell';
import './ui/styles.css';

async function boot(): Promise<void> {
  const project = (await loadInitialProject()) ?? createSampleProject();
  const ctx = createAppContext(project);
  const root = document.getElementById('app')!;
  mountApp(root, ctx);
  // Expose for debugging and E2E tests.
  (window as unknown as { crafting: typeof ctx }).crafting = ctx;
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="padding:2rem;color:#b00">Failed to start Crafting:\n${String(err?.stack ?? err)}</pre>`;
});
