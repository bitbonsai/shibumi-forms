document.addEventListener("click", async (event) => {
  const link = event.target.closest(".pager-nav a");
  if (!link) return;
  event.preventDefault();
  try {
    const response = await fetch(link.href);
    if (!response.ok) throw new Error("fetch failed");
    const doc = new DOMParser().parseFromString(await response.text(), "text/html");
    const next = doc.querySelector("main");
    if (!next) throw new Error("no main");
    document.querySelector("main").replaceWith(next);
    history.pushState(null, "", link.href);
    const table = document.querySelector(".submission-section .table-wrap");
    const rect = table?.getBoundingClientRect();
    if (rect && rect.top < -8) {
      const smooth = !matchMedia("(prefers-reduced-motion: reduce)").matches;
      document.querySelector(".submission-section")?.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
    }
  } catch {
    location.href = link.href;
  }
});
window.addEventListener("popstate", () => location.reload());

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
  let copied = true;
  try {
    await navigator.clipboard.writeText(target.textContent);
  } catch {
    copied = false;
  }
  if (button.classList.contains("icon-button")) {
    if (copied) {
      button.classList.add("copied");
      setTimeout(() => button.classList.remove("copied"), 1600);
    }
    return;
  }
  const label = button.textContent.trim();
  button.textContent = copied ? "Copied" : "Copy failed";
  setTimeout(() => { button.textContent = label; }, 1600);
});
