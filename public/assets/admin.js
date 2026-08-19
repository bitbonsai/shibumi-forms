let opener;
document.addEventListener("click", (event) => {
  const button = event.target.closest("[data-dialog], [data-close]");
  if (!button) return;
  if (button.dataset.dialog) {
    opener = button;
    document.getElementById(button.dataset.dialog)?.showModal();
  } else {
    button.closest("dialog")?.close();
  }
});
document.addEventListener("close", () => opener?.focus(), true);

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-copy-target]");
  if (!button) return;
  const target = document.getElementById(button.dataset.copyTarget);
  if (!target) return;
  const label = button.textContent.trim();
  try {
    await navigator.clipboard.writeText(target.textContent);
    button.textContent = "Copied";
  } catch {
    button.textContent = "Copy failed";
  }
  setTimeout(() => { button.textContent = label; }, 1600);
});
