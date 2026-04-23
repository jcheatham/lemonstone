// <ls-category-nav> — drill-down category selector column.
//
// Modes:
//   picker — wide column with a row per category. Clicking any row drills
//            in immediately and the column collapses to the rail.
//   rail   — narrow vertical strip showing the active category with rotated
//            text. Clicking the rail returns to picker mode.
//
// Properties:
//   categories  — Category[] (id + label)
//   mode        — "picker" | "rail"
//   previewed   — id of the category to visually highlight in picker (usually
//                 the last-active category, for when the rail expands back)
//   active      — id of the category last drilled into (rail mode source)
//
// Events (bubbles, composed):
//   category-drill — detail: { id }  user committed to a category
//   rail-expand    — user clicked the rail; caller should switch mode

export interface Category {
  id: string;
  label: string;
}

const style = `
  :host {
    display: flex;
    flex-direction: column;
    width: 200px;
    border-right: 1px solid var(--ls-color-border, #2a2a3e);
    background: var(--ls-color-bg-sidebar, #16162a);
    flex-shrink: 0;
    overflow: hidden;
    transition: width 180ms ease;
  }
  :host(.rail) { width: 44px; }

  /* Picker mode (default) */
  .picker-list {
    display: flex;
    flex-direction: column;
    padding: 8px 0;
    flex: 1;
  }
  :host(.rail) .picker-list { display: none; }

  .picker-footer {
    padding: 8px 14px 10px;
    border-top: 1px solid var(--ls-color-border, #2a2a3e);
  }
  :host(.rail) .picker-footer { display: none; }
  ::slotted([slot="footer"]) {
    color: var(--ls-color-fg-muted, #64748b);
    font-size: 11px;
    font-family: var(--ls-font-mono, monospace);
  }

  .picker-row {
    display: flex;
    align-items: center;
    padding: 10px 14px;
    background: none;
    border: none;
    color: var(--ls-color-fg-muted, #64748b);
    font-family: inherit;
    font-size: 13px;
    font-weight: 500;
    cursor: pointer;
    text-align: left;
    letter-spacing: 0.02em;
    border-left: 2px solid transparent;
  }
  .picker-row:hover {
    color: var(--ls-color-fg, #e0e0e0);
    background: rgba(255,255,255,0.03);
  }
  .picker-row.selected {
    color: var(--ls-color-accent, #7c6af7);
    border-left-color: var(--ls-color-accent, #7c6af7);
    background: rgba(124,106,247,0.08);
  }
  .picker-row .chevron {
    margin-left: auto;
    opacity: 0;
    font-size: 11px;
    transition: opacity 0.1s, transform 0.1s;
  }
  .picker-row.selected .chevron { opacity: 1; }
  .picker-row.selected:hover .chevron { transform: translateX(2px); }

  /* Rail mode */
  .rail {
    display: none;
    flex: 1;
    flex-direction: column;
    align-items: center;
    padding: 10px 0;
    cursor: pointer;
    color: var(--ls-color-fg-muted, #64748b);
    user-select: none;
  }
  :host(.rail) .rail { display: flex; }
  .rail:hover { color: var(--ls-color-fg, #e0e0e0); background: rgba(255,255,255,0.03); }
  .rail .rail-label {
    writing-mode: vertical-rl;
    transform: rotate(180deg);
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ls-color-accent, #7c6af7);
    margin-top: 12px;
  }
`;

export class LSCategoryNav extends HTMLElement {
  #shadow: ShadowRoot;
  #categories: Category[] = [];
  #mode: "picker" | "rail" = "picker";
  #previewed = "";
  #active: string | null = null;

  constructor() {
    super();
    this.#shadow = this.attachShadow({ mode: "open" });
    const sheet = document.createElement("style");
    sheet.textContent = style;
    this.#shadow.appendChild(sheet);
    this.#shadow.appendChild(document.createElement("div")); // placeholder body
  }

  connectedCallback(): void {
    // Mode class is applied here (not in the constructor) because custom-element
    // constructors may run before the element is fully upgraded/attached, and
    // attribute/class mutations at that point are unreliable.
    this.classList.toggle("rail", this.#mode === "rail");
    this.#render();
  }

  get categories(): Category[] { return this.#categories; }
  set categories(v: Category[]) { this.#categories = v; this.#render(); }

  get mode(): "picker" | "rail" { return this.#mode; }
  set mode(v: "picker" | "rail") {
    if (this.#mode === v) return;
    this.#mode = v;
    this.classList.toggle("rail", v === "rail");
    this.#render();
  }

  get previewed(): string { return this.#previewed; }
  set previewed(v: string) { this.#previewed = v; this.#render(); }

  get active(): string | null { return this.#active; }
  set active(v: string | null) { this.#active = v; this.#render(); }

  // ── Render ────────────────────────────────────────────────────────────────

  #render(): void {
    const body = this.#shadow.lastElementChild as HTMLElement;
    body.replaceChildren();

    if (this.#mode === "picker") {
      const list = document.createElement("div");
      list.className = "picker-list";
      for (const cat of this.#categories) {
        const row = document.createElement("button");
        row.className = "picker-row" + (cat.id === this.#previewed ? " selected" : "");
        row.dataset["id"] = cat.id;

        const label = document.createElement("span");
        label.textContent = cat.label;
        const chev = document.createElement("span");
        chev.className = "chevron";
        chev.textContent = "›";

        row.append(label, chev);
        row.addEventListener("click", () => this.#onRowClick(cat.id));
        row.addEventListener("keydown", (e) => this.#onRowKey(e, cat.id));
        list.appendChild(row);
      }
      body.appendChild(list);

      // Footer area: parent can project a footer element (e.g. build SHA
      // link) via <x slot="footer">. Only rendered in picker mode — no space
      // for it when the nav is collapsed to a rail.
      const footer = document.createElement("div");
      footer.className = "picker-footer";
      const slot = document.createElement("slot");
      slot.name = "footer";
      footer.appendChild(slot);
      body.appendChild(footer);
    } else {
      const cat = this.#categories.find(c => c.id === this.#active) ?? this.#categories[0];
      if (!cat) return;

      const rail = document.createElement("div");
      rail.className = "rail";
      rail.title = `Category: ${cat.label} — click to change`;
      rail.addEventListener("click", () => {
        this.dispatchEvent(new CustomEvent("rail-expand", { bubbles: true, composed: true }));
      });

      const label = document.createElement("div");
      label.className = "rail-label";
      label.textContent = cat.label;

      rail.appendChild(label);
      body.appendChild(rail);
    }
  }

  #onRowClick(id: string): void {
    // Single click drills in immediately — consistent behavior across
    // desktop and mobile. Update the internal "previewed" state so the
    // parent's re-render shows the right highlight if the rail is
    // subsequently expanded back to the picker.
    this.#previewed = id;
    this.#render();
    this.dispatchEvent(
      new CustomEvent("category-drill", { bubbles: true, composed: true, detail: { id } })
    );
  }

  #onRowKey(e: KeyboardEvent, id: string): void {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      this.#onRowClick(id);
    }
  }
}

customElements.define("ls-category-nav", LSCategoryNav);
