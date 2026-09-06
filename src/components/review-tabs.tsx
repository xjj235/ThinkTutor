"use client";

import { useId, useRef, useState, type ReactNode, type KeyboardEvent } from "react";

export function ReviewTabs({ tabs }: { tabs: Array<{ id: string; label: string; content: ReactNode }> }) {
  const prefix = useId();
  const [selected, setSelected] = useState(0);
  const buttons = useRef<Array<HTMLButtonElement | null>>([]);
  function navigate(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    const next = event.key === "ArrowRight" ? (index + 1) % tabs.length : event.key === "ArrowLeft" ? (index - 1 + tabs.length) % tabs.length : event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : null;
    if (next === null) return;
    event.preventDefault();
    setSelected(next);
    buttons.current[next]?.focus();
  }
  return <div className="review-tabs">
    <div role="tablist" aria-label="知识审核分区" className="review-tab-list">{tabs.map((tab, index) => <button key={tab.id} type="button" role="tab" id={`${prefix}-${tab.id}`} aria-controls={`${prefix}-${tab.id}-panel`} aria-selected={selected === index} tabIndex={selected === index ? 0 : -1} ref={(element) => { buttons.current[index] = element; }} onClick={() => setSelected(index)} onKeyDown={(event) => navigate(event, index)}>{tab.label}</button>)}</div>
    {tabs.map((tab, index) => <div key={tab.id} role="tabpanel" id={`${prefix}-${tab.id}-panel`} aria-labelledby={`${prefix}-${tab.id}`} hidden={selected !== index} tabIndex={0} className="review-tab-panel">{tab.content}</div>)}
  </div>;
}
