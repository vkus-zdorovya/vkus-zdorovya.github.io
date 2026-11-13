/* Подключается в <head> без defer, чтобы тема и цвет применились до отрисовки и не было «вспышки» */
(function () {
  try {
    const theme = JSON.parse(localStorage.getItem('ukr_theme'));
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    const accent = JSON.parse(localStorage.getItem('ukr_accent'));
    if (['ocean', 'berry', 'citrus', 'lavender'].includes(accent)) document.documentElement.dataset.accent = accent;
  } catch { /* хранилище недоступно */ }
})();
