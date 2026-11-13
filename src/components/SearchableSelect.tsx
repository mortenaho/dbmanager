import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

export function SearchableSelect(props: { value: string; label?: string; options: string[]; ariaLabel?: string; disabled?: boolean; width?: number; onChange: (value: string) => void }) {
  const id = useId();
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const [search, setSearch] = useState("");
  const [highlight, setHighlight] = useState(0);
  const options = props.options.filter((type) => type.toLowerCase().includes(search.trim().toLowerCase()));
  const active = Math.min(highlight, Math.max(0, options.length - 1));

  useEffect(() => {
    if (!anchor) return;
    const close = (event: Event) => {
      if (event.target instanceof Element && event.target.closest(".td-type-options")) return;
      setAnchor(null);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [anchor]);

  function choose(value: string) {
    props.onChange(value);
    setAnchor(null);
  }

  return (
    <>
      <input
        className="td-type-input"
        style={props.width ? { maxWidth: props.width } : undefined}
        role="combobox"
        aria-label={props.ariaLabel ?? "Data Type"}
        aria-autocomplete="list"
        aria-expanded={Boolean(anchor)}
        aria-controls={anchor ? id : undefined}
        aria-activedescendant={anchor && options.length ? `${id}-${active}` : undefined}
        value={anchor ? search : props.label ?? props.value}
        placeholder="Search..."
        disabled={props.disabled}
        onFocus={(event) => {
          setSearch("");
          setHighlight(0);
          setAnchor(event.currentTarget.getBoundingClientRect());
        }}
        onClick={(event) => {
          if (!anchor) {
            setSearch("");
            setHighlight(0);
            setAnchor(event.currentTarget.getBoundingClientRect());
          }
        }}
        onChange={(event) => { setSearch(event.target.value); setHighlight(0); }}
        onBlur={() => setAnchor(null)}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            setAnchor(null);
          } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!anchor) {
              setSearch("");
              setHighlight(0);
              setAnchor(event.currentTarget.getBoundingClientRect());
            } else {
              setHighlight(Math.max(0, Math.min(options.length - 1, active + (event.key === "ArrowDown" ? 1 : -1))));
            }
          } else if (event.key === "Enter" && anchor) {
            event.preventDefault();
            if (options[active]) choose(options[active]);
          }
        }}
      />
      {anchor && createPortal(
        <div id={id} role="listbox" aria-label={props.ariaLabel ?? "Data types"} className="td-type-options"
          style={{ width: anchor.width, boxSizing: "border-box", left: Math.max(4, Math.min(anchor.left, window.innerWidth - anchor.width - 4)), top: Math.min(anchor.bottom, window.innerHeight - 224) }}>
          {options.length ? options.map((type, index) => (
            <div key={type} id={`${id}-${index}`} role="option" aria-selected={index === active}
              ref={(node) => { if (node && index === active) node.scrollIntoView({ block: "nearest" }); }}
              onMouseDown={(event) => { event.preventDefault(); choose(type); }}>
              {type}
            </div>
          )) : <div className="td-type-empty">No matches</div>}
        </div>, document.body,
      )}
    </>
  );
}
