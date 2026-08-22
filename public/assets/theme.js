(() => {
  let stored;
  try { stored = localStorage.getItem("shibumi-theme"); } catch {}
  const theme = stored === "light" || stored === "dark"
    ? stored
    : (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
  document.documentElement.dataset.theme = theme;
})();

document.addEventListener("click", (event) => {
  if (!event.target.closest("[data-theme-toggle]")) return;
  const theme = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem("shibumi-theme", theme); } catch {}
});

document.addEventListener("click", (event) => {
  for (const menu of document.querySelectorAll("details.stack-menu[open]")) {
    if (!menu.contains(event.target)) menu.open = false;
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const menu = document.querySelector("details.stack-menu[open]");
  if (!menu) return;
  menu.open = false;
  menu.querySelector("summary")?.focus();
});
