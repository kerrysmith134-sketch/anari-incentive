import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";
import { createPortal } from "react-dom";
import { Icon, type IconName } from "./Icon.js";
import { statusTone, titleCase } from "../lib/format.js";
import { zhStatus } from "../lib/zh.js";

/* ------------------------------------------------------------------ button */

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "ghost" | "danger" | "quiet";
  size?: "sm" | "md";
  icon?: IconName;
  iconAfter?: IconName;
  loading?: boolean;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  iconAfter,
  loading = false,
  className = "",
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={`btn btn--${variant} btn--${size} ${className}`.trim()}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...props}
    >
      {loading ? (
        <span className="spinner" aria-hidden="true" />
      ) : icon ? (
        <Icon name={icon} size={size === "sm" ? 15 : 17} />
      ) : null}
      {children ? <span>{children}</span> : null}
      {iconAfter && !loading ? (
        <Icon name={iconAfter} size={size === "sm" ? 15 : 17} />
      ) : null}
    </button>
  );
}

export function IconButton({
  label,
  icon,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string;
  icon: IconName;
}) {
  return (
    <button
      type="button"
      className="icon-button"
      aria-label={label}
      title={label}
      {...props}
    >
      <Icon name={icon} size={18} />
    </button>
  );
}

/* ------------------------------------------------------------------- badge */

export function Badge({
  status,
  children,
  tone,
  dot = true,
}: {
  status?: string;
  children?: ReactNode;
  tone?: ReturnType<typeof statusTone>;
  dot?: boolean;
}) {
  const resolvedTone = tone ?? statusTone(status);
  return (
    <span className={`badge badge--${resolvedTone}`}>
      {dot ? <span className="badge__dot" aria-hidden="true" /> : null}
      {children ?? zhStatus(titleCase(status))}
    </span>
  );
}

/* ------------------------------------------------------------------- panel */

export function Panel({
  title,
  subtitle,
  action,
  children,
  className = "",
  flush = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  flush?: boolean;
}) {
  return (
    <section className={`panel ${className}`.trim()}>
      {title || action ? (
        <header className="panel__header">
          <div>
            {title ? <h2 className="panel__title">{title}</h2> : null}
            {subtitle ? <p className="panel__subtitle">{subtitle}</p> : null}
          </div>
          {action ? <div className="panel__action">{action}</div> : null}
        </header>
      ) : null}
      <div className={flush ? "panel__body panel__body--flush" : "panel__body"}>
        {children}
      </div>
    </section>
  );
}

/* -------------------------------------------------------------- page header */

export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="page-header__copy">
        {eyebrow ? <span className="eyebrow">{eyebrow}</span> : null}
        <h1>{title}</h1>
        {description ? <p>{description}</p> : null}
      </div>
      {actions ? <div className="page-header__actions">{actions}</div> : null}
    </header>
  );
}

/* ---------------------------------------------------------------- stat tile */

export function StatTile({
  label,
  value,
  detail,
  icon,
  tone = "neutral",
  meter,
}: {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  icon?: IconName;
  tone?: "neutral" | "good" | "warning" | "critical" | "accent";
  meter?: { value: number; label?: string };
}) {
  return (
    <article className={`stat-tile stat-tile--${tone}`}>
      <div className="stat-tile__top">
        <span className="stat-tile__label">{label}</span>
        {icon ? (
          <span className="stat-tile__icon" aria-hidden="true">
            <Icon name={icon} size={17} />
          </span>
        ) : null}
      </div>
      <div className="stat-tile__value">{value}</div>
      {detail ? <div className="stat-tile__detail">{detail}</div> : null}
      {meter ? (
        <div className="meter" aria-hidden="true">
          <span
            className="meter__fill"
            style={{ width: `${Math.min(100, Math.max(0, meter.value * 100))}%` }}
          />
        </div>
      ) : null}
      {meter?.label ? (
        <div className="stat-tile__meter-label">{meter.label}</div>
      ) : null}
    </article>
  );
}

/* -------------------------------------------------------------------- tabs */

export interface TabItem {
  id: string;
  label: string;
  count?: number;
}

export function Tabs({
  items,
  active,
  onChange,
  label = "Views",
}: {
  items: TabItem[];
  active: string;
  onChange: (id: string) => void;
  label?: string;
}) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          role="tab"
          aria-selected={active === item.id}
          className={`tabs__tab ${active === item.id ? "is-active" : ""}`}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.count !== undefined ? (
            <span className="tabs__count">{item.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------- modal */

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  wide = false,
}: {
  open: boolean;
  title: string;
  description?: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const dialog = dialogRef.current;
    const focusableSelector =
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusables = dialog
      ? Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
      : [];
    (focusables[0] ?? dialog)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
        return;
      }
      if (event.key !== "Tab" || !dialog) return;
      const candidates = Array.from(
        dialog.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => element.offsetParent !== null);
      if (candidates.length === 0) return;
      const first = candidates[0]!;
      const last = candidates[candidates.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previous;
      previouslyFocused?.focus?.();
    };
  }, [open, onClose]);

  if (!open) return null;

  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className={`modal ${wide ? "modal--wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        ref={dialogRef}
        tabIndex={-1}
      >
        <header className="modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {description ? <p>{description}</p> : null}
          </div>
          <IconButton label="关闭对话框" icon="close" onClick={onClose} />
        </header>
        <div className="modal__body">{children}</div>
        {footer ? <footer className="modal__footer">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------- forms */

export function FormField({
  label,
  hint,
  error,
  htmlFor,
  children,
  className = "",
}: {
  label: string;
  hint?: string;
  error?: string;
  htmlFor?: string;
  children: ReactNode;
  className?: string;
}) {
  const autoId = useId();
  const controlId = htmlFor ?? autoId;
  const control = isValidElement(children)
    ? cloneElement(children as ReactElement<{ id?: string; "aria-label"?: string }>, {
        id:
          (children.props as { id?: string }).id ??
          controlId,
        "aria-label":
          (children.props as { "aria-label"?: string })["aria-label"] ??
          label,
      })
    : children;
  return (
    <div className={`field ${className}`.trim()}>
      <label className="field__label" htmlFor={controlId}>
        {label}
      </label>
      {control}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : hint ? (
        <span className="field__hint">{hint}</span>
      ) : null}
    </div>
  );
}

export function TextInput({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`input ${className}`.trim()} {...props} />;
}

export function Select({
  className = "",
  children,
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <div className="select-wrap">
      <select className={`input select ${className}`.trim()} {...props}>
        {children}
      </select>
      <Icon name="chevron-down" size={15} />
    </div>
  );
}

export function Textarea({
  className = "",
  ...props
}: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`input textarea ${className}`.trim()} {...props} />;
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Search",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="search-input">
      <Icon name="search" size={16} />
      <input
        type="search"
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        aria-label={placeholder}
      />
      {value ? (
        <button
          type="button"
          aria-label="清除搜索"
          onClick={() => onChange("")}
        >
          <Icon name="close" size={13} />
        </button>
      ) : null}
    </div>
  );
}

/* -------------------------------------------------------------- data states */

export function EmptyState({
  icon = "layers",
  title,
  description,
  action,
}: {
  icon?: IconName;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-state__icon" aria-hidden="true">
        <Icon name={icon} size={22} />
      </span>
      <h3>{title}</h3>
      {description ? <p>{description}</p> : null}
      {action ? <div className="empty-state__action">{action}</div> : null}
    </div>
  );
}

export function LoadingRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="skeleton-stack" aria-label="加载中" role="status">
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton-row">
          <span className="skeleton skeleton--wide" />
          <span className="skeleton" />
          <span className="skeleton skeleton--short" />
        </div>
      ))}
    </div>
  );
}

export function ErrorNotice({
  title = "数据加载失败",
  error,
  onRetry,
}: {
  title?: string;
  error: Error;
  onRetry?: () => void;
}) {
  return (
    <div className="notice notice--danger" role="alert">
      <Icon name="alert-circle" size={19} />
      <div>
        <strong>{title}</strong>
        <p>{error.message}</p>
      </div>
      {onRetry ? (
        <Button variant="quiet" size="sm" icon="refresh" onClick={onRetry}>
          重试
        </Button>
      ) : null}
    </div>
  );
}

export function InfoNotice({
  children,
  tone = "info",
}: {
  children: ReactNode;
  tone?: "info" | "warning" | "success";
}) {
  return (
    <div className={`notice notice--${tone}`}>
      <Icon
        name={
          tone === "warning"
            ? "alert-circle"
            : tone === "success"
              ? "check-circle"
              : "info"
        }
        size={18}
      />
      <div>{children}</div>
    </div>
  );
}

export function Avatar({ name, size = 32 }: { name: string; size?: number }) {
  const initials =
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part.charAt(0).toUpperCase())
      .join("") || "?";
  return (
    <span
      className="avatar"
      style={{ width: size, height: size, fontSize: size * 0.36 }}
      aria-hidden="true"
    >
      {initials}
    </span>
  );
}

export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy-button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1400);
        } catch {
          /* clipboard may be unavailable */
        }
      }}
      title={label}
    >
      <Icon name={copied ? "check" : "key"} size={13} />
      <span>{copied ? "Copied" : label}</span>
    </button>
  );
}

export function DefinitionList({
  items,
}: {
  items: Array<{ label: string; value: ReactNode }>;
}) {
  return (
    <dl className="definition-list">
      {items.map((item) => (
        <div key={item.label} className="definition-list__row">
          <dt>{item.label}</dt>
          <dd>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
