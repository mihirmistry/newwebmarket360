// Centred confirmation modal for the admin panel (instead of the browser's confirm()). Built on <dialog>, so focus
// stays inside it and Escape cancels; clicking the dimmed backdrop cancels too. Cancel has focus first.
export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  /** Red confirm button and a warning icon, for deletes */
  danger?: boolean;
}

const ICON_TRASH = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/></svg>`;
const ICON_ALERT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 9v4M12 17h.01"/><path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z"/></svg>`;

export function confirmDialog(opts: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    const dialog = document.createElement("dialog");
    dialog.className = `adm-dialog${opts.danger ? " is-danger" : ""}`;
    dialog.setAttribute("aria-labelledby", "adm-dialog-title");
    dialog.setAttribute("aria-describedby", "adm-dialog-text");

    const icon = document.createElement("span");
    icon.className = "adm-dialog-icon";
    icon.innerHTML = opts.danger ? ICON_TRASH : ICON_ALERT;
    const title = document.createElement("h2");
    title.id = "adm-dialog-title";
    title.textContent = opts.title;
    const text = document.createElement("p");
    text.id = "adm-dialog-text";
    text.textContent = opts.message;

    const actions = document.createElement("div");
    actions.className = "adm-dialog-actions";
    const cancel = document.createElement("button");
    cancel.type = "button";
    cancel.className = "adm-btn is-ghost";
    cancel.textContent = "Cancel";
    const ok = document.createElement("button");
    ok.type = "button";
    ok.className = `adm-btn ${opts.danger ? "is-danger" : "is-primary"}`;
    ok.textContent = opts.confirmLabel ?? "Confirm";
    actions.append(cancel, ok);
    dialog.append(icon, title, text, actions);

    let answered = false;
    const finish = (value: boolean) => {
      if (answered) return;
      answered = true;
      dialog.close();
      dialog.remove();
      resolve(value);
    };
    cancel.addEventListener("click", () => finish(false));
    ok.addEventListener("click", () => finish(true));
    dialog.addEventListener("cancel", (e) => {
      e.preventDefault();
      finish(false);
    });
    // a click on the backdrop (outside the box) cancels
    dialog.addEventListener("click", (e) => {
      if (e.target === dialog) finish(false);
    });

    document.body.appendChild(dialog);
    dialog.showModal();
    cancel.focus();
  });
}
