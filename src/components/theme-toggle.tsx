"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

type Theme = "light" | "dark";

const storageKey = "thinktutor-theme";
const listeners = new Set<() => void>();
let theme: Theme = "light";
let initialized = false;

function applyTheme(nextTheme: Theme) {
  theme = nextTheme;
  document.documentElement.dataset.theme = nextTheme;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!initialized) {
    initialized = true;
    let savedTheme: Theme = "light";
    try {
      savedTheme = window.localStorage.getItem(storageKey) === "dark" ? "dark" : "light";
    } catch {
      // Storage access is optional; the in-memory preference still works.
    }
    applyTheme(savedTheme);
  }
  return () => { listeners.delete(listener); };
}

function getSnapshot() {
  return theme;
}

function getServerSnapshot(): Theme {
  return "light";
}

function getReadySnapshot() {
  return initialized;
}

function getServerReadySnapshot() {
  return false;
}

function toggleTheme() {
  const nextTheme = theme === "light" ? "dark" : "light";
  applyTheme(nextTheme);
  try {
    window.localStorage.setItem(storageKey, nextTheme);
  } catch {
    // Keep the selected theme even when persistence is unavailable.
  }
}

export function ThemeToggle() {
  const currentTheme = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const ready = useSyncExternalStore(subscribe, getReadySnapshot, getServerReadySnapshot);
  const label = currentTheme === "light" ? "切换为深色" : "切换为浅色";

  return (
    <button type="button" className="icon-button theme-toggle" aria-label={label} title={label} onClick={toggleTheme} disabled={!ready} aria-busy={!ready}>
      {currentTheme === "light" ? <Moon size={18} aria-hidden="true" /> : <Sun size={18} aria-hidden="true" />}
    </button>
  );
}
