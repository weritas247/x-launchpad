// ─── REUSABLE CONTEXT MENU ──────────────────────────────────────
export class ContextMenu {
  _items: any;
  _handler: any;
  _el: any;
  _onDocClick: any;
  _backdrop: any;
  /**
   * @param {Array<{label:string, action:string, danger?:boolean, when?:(ctx:any)=>boolean}|'---'>} items
   * @param {(action:string, context:any)=>void} handler
   */
  constructor(items, handler) {
    this._items = items;
    this._handler = handler;
    this._el = null;
    this._onDocClick = () => this.hide();
  }

  show(event, context) {
    event.preventDefault();
    event.stopPropagation();
    this.hide(); // remove previous

    // Filter items by `when` predicate
    const visible = this._items.filter((it) => it === '---' || !it.when || it.when(context));

    // Collapse adjacent/leading/trailing separators
    const cleaned = [];
    for (let i = 0; i < visible.length; i++) {
      if (visible[i] === '---') {
        if (cleaned.length === 0) continue; // leading
        if (cleaned[cleaned.length - 1] === '---') continue; // adjacent
        cleaned.push(visible[i]);
      } else {
        cleaned.push(visible[i]);
      }
    }
    // Remove trailing separator
    if (cleaned.length && cleaned[cleaned.length - 1] === '---') cleaned.pop();

    if (cleaned.length === 0) return;

    // Build DOM
    const menu = document.createElement('div');
    menu.className = 'ctx-menu visible';

    for (const it of cleaned) {
      if (it === '---') {
        const sep = document.createElement('div');
        sep.className = 'ctx-sep';
        menu.appendChild(sep);
      } else {
        const item = document.createElement('div');
        item.className = 'ctx-item' + (it.danger ? ' danger' : '');
        item.textContent = it.label;
        item.addEventListener('click', (e) => {
          e.stopPropagation();
          this.hide();
          this._handler(it.action, context);
        });
        menu.appendChild(item);
      }
    }

    // Position
    document.body.appendChild(menu);
    this._el = menu;

    const isMobileView = window.matchMedia('(max-width: 768px)').matches;

    if (isMobileView) {
      // Action sheet style (bottom of screen)
      menu.classList.add('mobile-action-sheet');
      this._backdrop = document.createElement('div');
      this._backdrop.style.cssText =
        'position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:8999';
      this._backdrop.addEventListener('click', () => this.hide());
      document.body.insertBefore(this._backdrop, menu);
    } else {
      // Desktop: viewport boundary check
      const rect = menu.getBoundingClientRect();
      let x = event.clientX;
      let y = event.clientY;
      if (x + rect.width > window.innerWidth) x = window.innerWidth - rect.width - 4;
      if (y + rect.height > window.innerHeight) y = window.innerHeight - rect.height - 4;
      if (x < 0) x = 4;
      if (y < 0) y = 4;
      menu.style.left = x + 'px';
      menu.style.top = y + 'px';
    }

    // Close on outside click (next tick to avoid immediate trigger)
    requestAnimationFrame(() => {
      document.addEventListener('click', this._onDocClick);
    });
  }

  hide() {
    if (this._backdrop) {
      this._backdrop.remove();
      this._backdrop = null;
    }
    if (this._el) {
      this._el.remove();
      this._el = null;
    }
    document.removeEventListener('click', this._onDocClick);
  }
}
