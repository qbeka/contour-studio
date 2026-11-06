/** Small form controls. Real inputs with labels, nothing custom underneath. */

import { useEffect, useId, useState, type ReactNode } from 'react';

interface NumberProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** Shows a range slider above the number. */
  slider?: boolean;
  /** The slider moves in equal ratios. Needs min above 0. */
  logarithmic?: boolean;
  unit?: string;
  hint?: string;
  digits?: number;
  onChange(value: number): void;
}

function toSlider(value: number, min: number, max: number): number {
  return Math.log(Math.max(value, min) / min) / Math.log(max / min);
}

function fromSlider(position: number, min: number, max: number): number {
  return min * (max / min) ** position;
}

export function NumberField(props: NumberProps) {
  const { label, value, min, max, step, slider, logarithmic, unit, hint, digits, onChange } = props;
  const id = useId();
  const show = (v: number) => (digits === undefined ? String(v) : String(Number(v.toFixed(digits))));
  const [text, setText] = useState(show(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(show(value));
    setInvalid(false);
  }, [value, digits]);

  const accept = (raw: string) => {
    setText(raw);
    const parsed = Number(raw);
    const ok = raw.trim() !== '' && Number.isFinite(parsed) && parsed >= min && parsed <= max;
    setInvalid(!ok);
    if (ok) onChange(parsed);
  };

  return (
    <div className="field" data-invalid={invalid || undefined}>
      <div className="field-row">
        <label htmlFor={id}>{label}</label>
        <span className="field-value">
          <input
            id={id}
            type="number"
            inputMode="decimal"
            value={text}
            min={min}
            max={max}
            step={step}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${id}-error` : undefined}
            onChange={(event) => accept(event.target.value)}
            onBlur={() => {
              setText(show(value));
              setInvalid(false);
            }}
          />
          {unit && <span className="field-unit">{unit}</span>}
        </span>
      </div>
      {slider && (
        <input
          type="range"
          aria-label={`${label} slider`}
          min={logarithmic ? 0 : min}
          max={logarithmic ? 1 : max}
          step={logarithmic ? 0.001 : step}
          value={logarithmic ? toSlider(value, min, max) : value}
          onChange={(event) => {
            const position = Number(event.target.value);
            const next = logarithmic ? fromSlider(position, min, max) : position;
            onChange(digits === undefined ? next : Number(next.toFixed(digits)));
          }}
        />
      )}
      {invalid && (
        <p className="field-error" id={`${id}-error`}>
          Enter a number from {min} to {max}.
        </p>
      )}
      {hint && !invalid && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function TextField({
  label,
  value,
  maxLength,
  onChange,
}: {
  label: string;
  value: string;
  maxLength: number;
  onChange(value: string): void;
}) {
  const id = useId();
  return (
    <div className="field">
      <div className="field-row">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          type="text"
          className="text-input"
          value={value}
          maxLength={maxLength}
          onChange={(event) => onChange(event.target.value)}
        />
      </div>
    </div>
  );
}

export function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange(value: string): void;
}) {
  const id = useId();
  return (
    <div className="field">
      <div className="field-row">
        <label htmlFor={id}>{label}</label>
        <span className="field-value">
          <input id={id} type="color" value={value} onChange={(e) => onChange(e.target.value)} />
          <code>{value}</code>
        </span>
      </div>
    </div>
  );
}

export function CheckField({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange(checked: boolean): void;
}) {
  return (
    <label className="check">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

export function Choice<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onChange(value: T): void;
}) {
  const name = useId();
  return (
    <fieldset className="choice">
      <legend>{label}</legend>
      <div className="choice-options">
        {options.map((option) => (
          <label key={option.value} data-checked={option.value === value || undefined}>
            <input
              type="radio"
              name={name}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export function Advanced({ title, children }: { title: string; children: ReactNode }) {
  return (
    <details className="advanced">
      <summary>{title}</summary>
      <div className="advanced-body">{children}</div>
    </details>
  );
}

export function Icon({ name }: { name: IconName }) {
  return (
    <svg className="icon" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  );
}

export type IconName =
  | 'select'
  | 'peak'
  | 'ridge'
  | 'pan'
  | 'undo'
  | 'redo'
  | 'fit'
  | 'help'
  | 'eye'
  | 'eyeOff'
  | 'copy'
  | 'trash';

const ICONS: Record<IconName, ReactNode> = {
  select: <path d="M5 3.5 15.5 10l-4.8 1.2L8.4 16z" />,
  peak: (
    <>
      <ellipse cx="10" cy="10" rx="7" ry="6" />
      <ellipse cx="10" cy="10" rx="3.2" ry="2.6" />
    </>
  ),
  ridge: (
    <>
      <path d="M2.5 13c3-5 5-6 7.5-4s4.500 1 7.500-3" />
      <circle cx="2.700" cy="13" r="1" />
      <circle cx="17.300" cy="6" r="1" />
    </>
  ),
  pan: <path d="M10 2.500v15M2.500 10h15M10 2.500 8 4.500M10 2.500l2 2M10 17.500l-2-2M10 17.500l2-2M2.500 10l2-2M2.500 10l2 2M17.500 10l-2-2M17.500 10l-2 2" />,
  undo: <path d="M7 5 3.500 8.500 7 12M3.500 8.500H12a4.500 4.500 0 0 1 0 9H9" />,
  redo: <path d="m13 5 3.500 3.500L13 12m3.500-3.500H8a4.500 4.500 0 0 0 0 9h3" />,
  fit: <path d="M3 7V3h4M13 3h4v4M17 13v4h-4M7 17H3v-4" />,
  help: (
    <>
      <path d="M2.500 6.500h15v8h-15z" />
      <path d="M5.500 9.500h.01M8.500 9.500h.01M11.500 9.500h.01M14.500 9.500h.01M6.500 12h7" />
    </>
  ),
  eye: (
    <>
      <path d="M2 10s3-5.500 8-5.500S18 10 18 10s-3 5.500-8 5.500S2 10 2 10z" />
      <circle cx="10" cy="10" r="2.200" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M2 10s3-5.500 8-5.500S18 10 18 10s-3 5.500-8 5.500S2 10 2 10z" />
      <path d="m4 16 12-12" />
    </>
  ),
  copy: (
    <>
      <path d="M7 7h9.500v9.500H7z" />
      <path d="M13 7V3.500H3.500V13H7" />
    </>
  ),
  trash: <path d="M3.500 5.500h13M8 5.500V3.500h4v2M5 5.500l.8 11h8.400l.8-11" />,
};
