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
