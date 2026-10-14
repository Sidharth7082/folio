"use client";

import {
  DEFAULT_SETTINGS,
  SETTINGS_BOUNDS,
  readerStore,
  useReaderSettings,
} from "@/lib/progress";
import type { ReaderAlign, ReaderFont, ReaderSettings as Settings, ReaderTheme } from "@/lib/progress";

const THEMES: { value: ReaderTheme; label: string }[] = [
  { value: "light", label: "Light" },
  { value: "sepia", label: "Sepia" },
  { value: "dark", label: "Dark" },
];

const FONTS: { value: ReaderFont; label: string }[] = [
  { value: "serif", label: "Serif" },
  { value: "sans", label: "Sans" },
];

const ALIGNMENTS: { value: ReaderAlign; label: string }[] = [
  { value: "left", label: "Left" },
  { value: "justify", label: "Justify" },
];

interface ReaderSettingsProps {
  open: boolean;
  onClose: () => void;
}

export function ReaderSettings({ open, onClose }: ReaderSettingsProps) {
  const settings = useReaderSettings();
  const update = (patch: Partial<Settings>) => readerStore.updateSettings(patch);

  if (!open) return null;

  return (
    <div className="absolute right-0 top-full z-30 mt-2 w-80 rounded-xl border border-[var(--reader-border)] bg-[var(--reader-surface)] p-4 text-[var(--reader-fg)] shadow-[var(--shadow)]">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold">Reading settings</p>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-xs text-[var(--reader-fg-muted)] hover:bg-[var(--reader-surface-2)] hover:text-[var(--reader-fg)]"
        >
          Close
        </button>
      </div>

      <Field label="Theme">
        <Segmented
          options={THEMES}
          value={settings.theme}
          onChange={(theme) => update({ theme })}
        />
      </Field>

      <Field label="Typeface">
        <Segmented options={FONTS} value={settings.font} onChange={(font) => update({ font })} />
      </Field>

      <Field label="Alignment">
        <Segmented
          options={ALIGNMENTS}
          value={settings.align}
          onChange={(align) => update({ align })}
        />
      </Field>

      <Field label={`Font size — ${settings.fontSize}px`}>
        <input
          type="range"
          min={SETTINGS_BOUNDS.fontSize.min}
          max={SETTINGS_BOUNDS.fontSize.max}
          step={SETTINGS_BOUNDS.fontSize.step}
          value={settings.fontSize}
          onChange={(event) => update({ fontSize: Number(event.target.value) })}
          className="w-full accent-[var(--accent)]"
        />
      </Field>

      <Field label={`Line height — ${settings.lineHeight.toFixed(2)}`}>
        <input
          type="range"
          min={SETTINGS_BOUNDS.lineHeight.min}
          max={SETTINGS_BOUNDS.lineHeight.max}
          step={SETTINGS_BOUNDS.lineHeight.step}
          value={settings.lineHeight}
          onChange={(event) => update({ lineHeight: Number(event.target.value) })}
          className="w-full accent-[var(--accent)]"
        />
      </Field>

      <Field label={`Column width — ${settings.width}ch`}>
        <input
          type="range"
          min={SETTINGS_BOUNDS.width.min}
          max={SETTINGS_BOUNDS.width.max}
          step={SETTINGS_BOUNDS.width.step}
          value={settings.width}
          onChange={(event) => update({ width: Number(event.target.value) })}
          className="w-full accent-[var(--accent)]"
        />
      </Field>

      <button
        type="button"
        onClick={() => readerStore.resetSettings()}
        className="mt-3 w-full rounded-lg border border-[var(--reader-border)] px-3 py-2 text-xs font-medium text-[var(--reader-fg-muted)] transition-colors hover:bg-[var(--reader-surface-2)] hover:text-[var(--reader-fg)]"
      >
        Reset to defaults ({DEFAULT_SETTINGS.fontSize}px, {DEFAULT_SETTINGS.theme})
      </button>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mt-4">
      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-[var(--reader-fg-muted)]">
        {label}
      </p>
      {children}
    </div>
  );
}

function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="grid grid-cols-3 gap-1 rounded-lg border border-[var(--reader-border)] bg-[var(--reader-surface-2)] p-1">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={[
            "rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
            option.value === value
              ? "bg-accent text-accent-ink"
              : "text-[var(--reader-fg-muted)] hover:text-[var(--reader-fg)]",
          ].join(" ")}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
