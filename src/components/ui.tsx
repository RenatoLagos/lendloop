import type { ButtonHTMLAttributes } from "react";

const base = "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-sm font-medium transition disabled:opacity-50";

export function Button({ variant = "primary", className = "", ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "danger" }) {
  const styles = {
    primary: "bg-emerald-700 text-white hover:bg-emerald-800",
    secondary: "border border-stone-300 bg-white hover:bg-stone-100",
    danger: "border border-red-300 bg-white text-red-700 hover:bg-red-50",
  }[variant];
  return <button className={`${base} ${styles} ${className}`} {...rest} />;
}

const STATUS_STYLES: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-800",
  reserved: "bg-amber-100 text-amber-800",
  on_loan: "bg-stone-200 text-stone-700",
  requested: "bg-sky-100 text-sky-800",
  approved: "bg-emerald-100 text-emerald-800",
  active: "bg-indigo-100 text-indigo-800",
  declined: "bg-red-100 text-red-800",
  returned: "bg-stone-200 text-stone-700",
  overdue: "bg-red-100 text-red-800",
};

export function Badge({ kind, children }: { kind: string; children?: React.ReactNode }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[kind] ?? "bg-stone-100"}`}>
      {children ?? kind.replace("_", " ")}
    </span>
  );
}

export function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-lg border border-stone-200 bg-white p-4 shadow-sm ${className}`}>{children}</div>;
}

export function PageTitle({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      {subtitle && <p className="mt-1 text-sm text-stone-600">{subtitle}</p>}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <p className="rounded-lg border border-dashed border-stone-300 p-6 text-center text-sm text-stone-500">{children}</p>;
}

export const inputClass = "w-full rounded-md border border-stone-300 bg-white px-3 py-1.5 text-sm focus:border-emerald-600 focus:outline-none focus:ring-1 focus:ring-emerald-600";
