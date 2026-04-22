export type ToastVariant = "info" | "success" | "warning" | "error";

const template = document.createElement("template");
template.innerHTML = `
<style>
  :host {
    position: fixed;
    bottom: 40px;
    right: 24px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    z-index: 200;
    pointer-events: none;
  }
  .toast {
    padding: 10px 16px;
    border-radius: 6px;
    font-size: 13px;
    line-height: 1.4;
    pointer-events: auto;
    animation: slide-in 0.2s ease;
    max-width: 320px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.4);
  }
  .toast.info    { background: #2d3a52; color: #93c5fd; }
  .toast.success { background: #1e3a2a; color: #86efac; }
  .toast.warning { background: #3a2f1a; color: #fcd34d; }
  .toast.error   { background: #3a1a1a; color: #f87171; }
  .toast.action  { display: flex; align-items: center; gap: 12px; }
  .toast.action button {
    background: rgba(255,255,255,0.12);
    color: inherit;
    border: 1px solid currentColor;
    border-radius: 4px;
    padding: 3px 10px;
    font: inherit;
    font-size: 12px;
    cursor: pointer;
  }
  .toast.action button:hover { background: rgba(255,255,255,0.2); }
  .toast .dismiss {
    background: none;
    border: none;
    color: inherit;
    opacity: 0.6;
    cursor: pointer;
    font: inherit;
    font-size: 16px;
    padding: 0 4px;
  }
  .toast .dismiss:hover { opacity: 1; }
  @keyframes slide-in {
    from { transform: translateX(120%); opacity: 0; }
    to   { transform: translateX(0);   opacity: 1; }
  }
</style>
`;

export class LSToast extends HTMLElement {
  connectedCallback(): void {
    this.attachShadow({ mode: "open" }).appendChild(
      template.content.cloneNode(true)
    );
  }

  show(message: string, variant: ToastVariant = "info", durationMs = 4000): void {
    const shadow = this.shadowRoot!;
    const el = document.createElement("div");
    el.className = `toast ${variant}`;
    el.textContent = message;
    shadow.appendChild(el);
    setTimeout(() => el.remove(), durationMs);
  }

  /**
   * Sticky toast with an action button and a dismiss affordance. Used for
   * things that require user intent (e.g. "update available").
   * Returns a function that removes the toast imperatively.
   */
  showAction(
    message: string,
    actionLabel: string,
    onAction: () => void,
    variant: ToastVariant = "info"
  ): () => void {
    const shadow = this.shadowRoot!;
    const el = document.createElement("div");
    el.className = `toast action ${variant}`;
    const text = document.createElement("span");
    text.style.flex = "1";
    text.textContent = message;
    const actionBtn = document.createElement("button");
    actionBtn.textContent = actionLabel;
    actionBtn.addEventListener("click", () => {
      onAction();
      el.remove();
    });
    const dismissBtn = document.createElement("button");
    dismissBtn.className = "dismiss";
    dismissBtn.textContent = "×";
    dismissBtn.title = "Dismiss";
    dismissBtn.addEventListener("click", () => el.remove());
    el.append(text, actionBtn, dismissBtn);
    shadow.appendChild(el);
    return () => el.remove();
  }
}

customElements.define("ls-toast", LSToast);

// Global singleton convenience helper.
let toastEl: LSToast | null = null;
export function getToast(): LSToast {
  if (!toastEl) {
    toastEl = document.createElement("ls-toast") as LSToast;
    document.body.appendChild(toastEl);
  }
  return toastEl;
}
