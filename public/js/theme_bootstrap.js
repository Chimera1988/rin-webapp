(function bootstrapRinTheme() {
  const key = 'rin-theme';
  const normalize = value => value === 'theme-light' ? 'theme-light' : 'theme-dark';

  function apply(next, persist = true) {
    const theme = normalize(next);
    document.documentElement.classList.remove('theme-dark', 'theme-light');
    document.documentElement.classList.add(theme);
    if (persist) {
      try { localStorage.setItem(key, theme); } catch {}
    }
    return theme;
  }

  let stored = null;
  try { stored = localStorage.getItem(key); } catch {}
  apply(stored, false);
  window.__rinSetTheme = apply;
})();
