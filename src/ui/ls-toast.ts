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
