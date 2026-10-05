"use client";

// ============================================================================
// NativeSelect, a styled, form-compatible replacement for the native <select>.
//
// WHY THIS EXISTS (and why it is not just CSS on <select>)
// The native <select> popup is rendered by the browser itself, outside the
// document. In Chrome/Safari device-emulation mode that popup is anchored to
// the *document origin*, not to the button the user tapped, so on a scrolled
// mobile page the option list appears detached from its control, looking
// broken even when the layout is perfectly correct. There is no CSS that can
// re-anchor it. The only reliable fix is to render the option list ourselves.
//
// THE TRADEOFF: this is a full listbox widget, so it needs keyboard handling,
// focus management, an outside-click dismissal, and a scroll lock. It is only
// worth that cost on controls the user interacts with by touch. Inputs for
// names/passwords stay plain `.field` inputs.
//
// FORM COMPATIBILITY
// A native <select> is the only control that submits without React state, and
// the admin filter forms rely on `form.requestSubmit()` reading `form.elements`
// directly. To keep that working, a REAL <select> is still rendered, visible
// on desktop (where the native popup is correct), hidden from view on mobile
// (where our listbox takes over). Both are driven from the same value, so the
// form submits identically either way.
//
// ACCESSIBILITY
// The trigger is a combobox (`role="combobox"`, aria-expanded, aria-controls)
// and the popover a listbox with real `role="option"` entries. Arrow/Home/End
// move focus, Enter/Space select, Escape closes and restores focus. Mobile
// screen readers see the hidden <select> instead, which exposes the native
// picker semantics they already know how to announce.
// ============================================================================

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

/**
 * @typedef SelectOption
 * @property {string} value The form value. Empty string is the placeholder.
 * @property {string} label What the operator reads.
 */

/**
 * @typedef NativeSelectProps
 * @property {string} id
 * @property {string} name Submitted form field name.
 * @property {string} value
 * @property {(value: string) => void} onChange
 * @property {SelectOption[]} options
 * @property {boolean} [disabled]
 * @property {string} [placeholder] Label for the empty-value option.
 * @property {string} [className]
 * @property {boolean} [invalid] Show the danger border (validation error).
 */

const MAX_VISIBLE_OPTIONS = 12;

// A single shared media-query subscription for every instance, the query never
// changes, so there is no reason for each select to own its own listener.
let listeners = new Set();
let mediaQuery = null;
function subscribeViewport(callback) {
  if (!mediaQuery) mediaQuery = window.matchMedia("(max-width: 640px)");
  const handler = () => {
    for (const cb of listeners) cb();
  };
  listeners.add(callback);
  if (listeners.size === 1) mediaQuery.addEventListener("change", handler);
  return () => {
    listeners.delete(callback);
    if (listeners.size === 0) {
      mediaQuery.removeEventListener("change", handler);
      mediaQuery = null;
    }
  };
}

export default function NativeSelect({
  id,
  name,
  value,
  onChange,
  options,
  disabled = false,
  placeholder,
  className = "",
  invalid = false,
}) {
  const buttonId = id;
  const listId = useId();
  const triggerRef = useRef(null);
  const popoverRef = useRef(null);
  const optsRef = useRef([]);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [popoverUp, setPopoverUp] = useState(false);

  const selectedIndex = useMemo(
    () => Math.max(0, options.findIndex((o) => o.value === value)),
    [options, value]
  );

  const selected = options[selectedIndex] ?? { label: placeholder ?? "", value: "" };

  // Reveal the custom listbox only on narrow touch-capable viewports,
  // desktop keeps the native popup, which anchors correctly there.
  // useSyncExternalStore keeps server/client markup identical during
  // hydration (the server renders `false`, the client re-renders after mount),
  // which is what prevents a React hydration mismatch warning.
  const mobile = useSyncExternalStore(
    subscribeViewport,
    () => window.matchMedia("(max-width: 640px)").matches,
    () => false
  );

  // Anchor the popover to the trigger on every resize while open, and flip it
  // above the control when the viewport bottom would clip the list.
  const place = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger || !open) return;
    const popover = popoverRef.current;
    if (popover) popover.style.minWidth = `${trigger.offsetWidth}px`;

    const r = trigger.getBoundingClientRect();
    const listH = Math.min(
      popover?.offsetHeight ?? MAX_VISIBLE_OPTIONS * 40,
      window.innerHeight * 0.45
    );
    setPopoverUp(window.innerHeight - r.bottom < listH + 16);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    place();
    const onScroll = () => place();
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, place]);

  // Trap focus inside the open listbox and restore it to the trigger on close.
  // Focus is what announces the chosen value; without this, picking an option
  // is a silent action to a keyboard or assistive-technology user.
  const focusOption = useCallback(
    (idx) => {
      const node = optsRef.current[idx];
      if (node) node.focus();
    },
    []
  );

  const openAt = useCallback(
    (idx) => {
      setActiveIndex(idx);
      setOpen(true);
      requestAnimationFrame(() => focusOption(idx));
    },
    [focusOption]
  );

  const close = useCallback(() => {
    setOpen(false);
    setActiveIndex(-1);
    triggerRef.current?.focus();
  }, []);

  const pick = useCallback(
    (idx) => {
      const opt = options[idx];
      if (!opt) return;
      onChange(opt.value);
      setOpen(false);
      setActiveIndex(-1);
    },
    [onChange, options]
  );

  // Dismiss on outside click, and lock body scroll while the popover is open so
  // the list cannot be scrolled away from under the user's finger.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (!popoverRef.current?.contains(e.target) && !triggerRef.current?.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.body.style.overflow = overflow;
    };
  }, [open]);

  // Type-to-select on the trigger: jump to the first label starting with the
  // typed character. In an open list the popover's own handler does this.
  const onKeyDown = (e) => {
    if (disabled) return;
    const count = options.length;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (e.key === "ArrowUp") openAt(selectedIndex);
      else if (open) setActiveIndex((i) => (i + 1) % count);
      else openAt(selectedIndex);
      return;
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      if (!open) return;
      e.preventDefault();
      setActiveIndex(e.key === "Home" ? 0 : count - 1);
      return;
    }
    if (/^.$/.test(e.key) && count) {
      const ch = e.key.toLowerCase();
      const hit = options.findIndex((o) => o.label.toLowerCase().startsWith(ch));
      if (hit >= 0) {
        e.preventDefault();
        if (open) setActiveIndex(hit);
        else pick(hit);
      }
    }
  };

  // Keyboard navigation INSIDE the open list. The trigger's own keydown opens
  // the list, but once it is open focus moves to an option, and those are
  // siblings of the trigger, not children, so its handler never fires. The
  // popover needs its own, otherwise arrows and Escape are dead keys.
  const onListKeyDown = (e) => {
    const count = options.length;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => {
        const next = (i + (e.key === "ArrowDown" ? 1 : count - 1)) % count;
        requestAnimationFrame(() => focusOption(next));
        return next;
      });
      return;
    }
    if (e.key === "Home" || e.key === "End") {
      e.preventDefault();
      const idx = e.key === "Home" ? 0 : count - 1;
      setActiveIndex(idx);
      requestAnimationFrame(() => focusOption(idx));
      return;
    }
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    if (e.key === "Tab") {
      // Keep focus in the list while open, Tab would leave the popover behind.
      e.preventDefault();
      setActiveIndex((i) => {
        const next = (i + (e.shiftKey ? count - 1 : 1)) % count;
        requestAnimationFrame(() => focusOption(next));
        return next;
      });
    }
  };

  const fieldCls = `field ${invalid ? "field-error" : ""} ${className}`.trim();

  return (
    <div id={id} className="relative">
      {/* Real control, submitted by the form. On mobile it is moved off-screen
          (still in the form, still in the DOM, still read by requestSubmit)
          and our combobox takes its place. The id lives on THIS wrapper so a
          `<label htmlFor>` points at something that still exists at the same
          place in the tree on both mobile and desktop. */}
      <select
        id={`${id}-native`}
        name={name}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        aria-hidden={mobile ? "true" : undefined}
        tabIndex={mobile ? -1 : 0}
        className={fieldCls}
        style={mobile ? { position: "absolute", width: 1, height: 1, margin: -1, padding: 0, border: 0, overflow: "hidden", clip: "rect(0 0 0 0)", opacity: 0 } : undefined}
      >
        {placeholder ? <option value="">{placeholder}</option> : null}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>

      {mobile ? (
        <div className="relative">
          <button
            ref={triggerRef}
            type="button"
            role="combobox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-haspopup="listbox"
            aria-activedescendant={open && activeIndex >= 0 ? `${listId}-opt-${activeIndex}` : undefined}
            disabled={disabled}
            onClick={() => (open ? close() : openAt(selectedIndex))}
            onKeyDown={onKeyDown}
            className={`${fieldCls} flex w-full items-center justify-between gap-2 text-left ${
              disabled ? "cursor-not-allowed" : ""
            }`}
          >
            <span className={selected.value ? "" : "text-foreground-subtle"}>{selected.label}</span>
            <svg
              aria-hidden="true"
              viewBox="0 0 16 16"
              className={`h-4 w-4 shrink-0 text-foreground-subtle transition-transform duration-150 ${
                open ? "rotate-180" : ""
              }`}
              fill="none"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M4 6.5 8 10.5 12 6.5" />
            </svg>
          </button>

          {open ? (
            <div
              ref={popoverRef}
              id={listId}
              role="listbox"
              aria-labelledby={buttonId}
              onKeyDown={onListKeyDown}
              tabIndex={-1}
              className={`absolute z-50 max-h-[45vh] w-full overflow-auto rounded-[var(--radius-control)] border border-border bg-surface-raised py-1 shadow-lg ring-1 ring-black/5 focus:outline-none dark:ring-white/10 ${
                popoverUp ? "bottom-full mb-1" : "top-full mt-1"
              }`}
            >
              {options.map((o, i) => (
                <button
                  key={o.value}
                  ref={(el) => (optsRef.current[i] = el)}
                  type="button"
                  role="option"
                  id={`${listId}-opt-${i}`}
                  aria-selected={i === selectedIndex}
                  onClick={() => pick(i)}
                  onMouseEnter={() => setActiveIndex(i)}
                  className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                    i === activeIndex
                      ? "bg-brand-soft text-brand-700 dark:bg-brand-soft dark:text-foreground"
                      : ""
                  } ${i === selectedIndex ? "font-semibold" : ""}`}
                >
                  <span className="flex-1">{o.label}</span>
                  {i === selectedIndex ? (
                    <svg
                      aria-hidden="true"
                      viewBox="0 0 16 16"
                      className="h-4 w-4 shrink-0 text-brand-600 dark:text-brand-400"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M3.5 8.5 6.5 11.5 12.5 5" />
                    </svg>
                  ) : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
