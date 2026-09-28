// Inlined into report.html by render/html.mjs. Two jobs: the
// copy-to-clipboard button (quality-gate.mjs checks this actually works),
// and a light/dark theme toggle for reading the report locally.

document.addEventListener('DOMContentLoaded', () => {
  const copyBtn = document.getElementById('copy-md-btn');
  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      const source = document.getElementById('markdown-source');
      const text = source ? source.textContent : '';
      const original = copyBtn.textContent;
      try {
        await navigator.clipboard.writeText(text);
        copyBtn.dataset.copied = 'true';
        copyBtn.textContent = 'Copied';
      } catch {
        copyBtn.dataset.copied = 'false';
        copyBtn.textContent = 'Copy failed — select the text below manually';
      }
      setTimeout(() => {
        copyBtn.textContent = original;
        delete copyBtn.dataset.copied;
      }, 1500);
    });
  }

  const themeToggle = document.getElementById('theme-toggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', () => {
      const root = document.documentElement;
      const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      const current = root.getAttribute('data-theme') || (prefersDark ? 'dark' : 'light');
      root.setAttribute('data-theme', current === 'dark' ? 'light' : 'dark');
    });
  }
});
