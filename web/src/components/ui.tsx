"use client";
import { type ComponentProps, type ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import {
  Activity,
  Bike,
  Dumbbell,
  Footprints,
  Waves,
  CircleDot,
  X,
  ArrowUpRight,
  AlertCircle,
} from "lucide-react";
import { copy } from "@/lib/i18n";
import type { Sport } from "@/lib/data";
export const cn = clsx;
export const buttonStyle = cva("button", {
  variants: {
    variant: {
      default: "button-primary",
      secondary: "button-secondary",
      outline: "button-outline",
      ghost: "button-ghost",
      destructive: "button-destructive",
      link: "button-link",
    },
    size: { default: "", sm: "button-sm", icon: "button-icon" },
  },
  defaultVariants: { variant: "default", size: "default" },
});
export function Button({
  variant = "default",
  size = "default",
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & VariantProps<typeof buttonStyle>) {
  return (
    <button
      type={type}
      className={buttonStyle({ variant, size, className })}
      data-slot="button"
      data-variant={variant}
      data-size={size}
      {...props}
    />
  );
}
export function Mark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      className={cn("mark", className)}
      aria-hidden="true"
    >
      <path
        d="M6 23V9h8.5a6 6 0 0 1 0 12H12m2-6 12 12M20 5h7v7"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
export function Card({ className, ...props }: ComponentProps<"section">) {
  return (
    <section className={cn("card", className)} data-slot="card" {...props} />
  );
}
export function CardHeading({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card-heading">
      <div>
        <h2>{title}</h2>
        {description && <p>{description}</p>}
      </div>
      {action}
    </div>
  );
}
export function Badge({
  children,
  accent = false,
  className,
}: {
  children: ReactNode;
  accent?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn("badge", accent && "badge-accent", className)}
      data-slot="badge"
    >
      {children}
    </span>
  );
}
const sportIcons = {
  run: Footprints,
  ride: Bike,
  gym: Dumbbell,
  football: CircleDot,
  swim: Waves,
  other: Activity,
};
export function SportIcon({
  sport,
  className,
}: {
  sport: Sport;
  className?: string;
}) {
  const Icon = sportIcons[sport];
  return (
    <span className={cn("sport-icon", className)}>
      <Icon size={17} strokeWidth={1.6} aria-hidden="true" />
    </span>
  );
}
export function Empty({
  title = copy.common.noData,
  description,
  icon,
}: {
  title?: string;
  description?: string;
  icon?: ReactNode;
}) {
  return (
    <div className="empty-state">
      {icon || <Activity size={22} strokeWidth={1.3} aria-hidden="true" />}
      <p className="empty-title">{title}</p>
      {description && <p>{description}</p>}
    </div>
  );
}
export function ErrorNotice({
  message,
  retry,
}: {
  message: string;
  retry?: () => void;
}) {
  return (
    <div className="error-notice" role="alert">
      <AlertCircle size={16} aria-hidden="true" />
      <span>{message}</span>
      {retry && (
        <Button variant="outline" size="sm" onClick={retry}>
          {copy.common.retry}
        </Button>
      )}
    </div>
  );
}
export function Skeleton({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={cn("skeleton-layout", compact && "compact")}
      role="status"
      aria-label={copy.common.loading}
    >
      <span className="sr-only">{copy.common.loading}</span>
      <div className="skeleton" />
      <div className="skeleton" />
      <div className="skeleton" />
    </div>
  );
}
export function Modal({
  open,
  onClose,
  title,
  description,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(value) => {
        if (!value) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="dialog-overlay" />
        <Dialog.Content className="dialog-content">
          <div className="dialog-header">
            <div>
              <Dialog.Title>{title}</Dialog.Title>
              <Dialog.Description>{description}</Dialog.Description>
            </div>
            <Dialog.Close asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={copy.common.close}
              >
                <X size={18} aria-hidden="true" />
              </Button>
            </Dialog.Close>
          </div>
          {children}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
export function ExternalActivityLink({ id }: { id: string }) {
  return (
    <a
      className={buttonStyle({ variant: "outline" })}
      href={`https://intervals.icu/activities/${encodeURIComponent(id)}`}
      target="_blank"
      rel="noopener noreferrer"
    >
      {copy.activity.external}
      <ArrowUpRight size={15} aria-hidden="true" />
    </a>
  );
}
