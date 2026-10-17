import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonStyles = cva("inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300/60 disabled:pointer-events-none disabled:opacity-50", {
  variants: {
    variant: {
      primary: "bg-emerald-300 text-[#07110d] hover:bg-emerald-200",
      secondary: "border border-white/10 bg-white/[0.035] text-slate-200 hover:bg-white/[0.08]",
      ghost: "text-slate-400 hover:bg-white/[0.06] hover:text-white",
      danger: "border border-rose-500/20 bg-rose-500/10 text-rose-300 hover:bg-rose-500/15",
    },
    size: { default: "h-9 px-3.5", sm: "h-8 px-2.5 text-xs", icon: "size-9" },
  },
  defaultVariants: { variant: "secondary", size: "default" },
});
export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonStyles> {}
export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, ...props }, ref) => <button ref={ref} className={cn(buttonStyles({ variant, size }), className)} {...props} />);
Button.displayName = "Button";

const badgeStyles = cva("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]", {
  variants: {
    tone: {
      neutral: "border-white/10 bg-white/[0.04] text-slate-300",
      green: "border-emerald-400/20 bg-emerald-400/[0.09] text-emerald-300",
      yellow: "border-amber-400/20 bg-amber-400/[0.09] text-amber-300",
      red: "border-rose-400/20 bg-rose-400/[0.09] text-rose-300",
      blue: "border-sky-400/20 bg-sky-400/[0.09] text-sky-300",
      purple: "border-violet-400/20 bg-violet-400/[0.09] text-violet-300",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeStyles>) {
  return <span className={cn(badgeStyles({ tone }), className)} {...props} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-2xl border border-white/[0.08] bg-[#0c1117] shadow-[0_16px_40px_rgba(0,0,0,.16)]", className)} {...props} />;
}
export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex items-start justify-between gap-4 p-5", className)} {...props} />;
}
export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-sm font-semibold text-slate-100", className)} {...props} />;
}
export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("px-5 pb-5", className)} {...props} />;
}
export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(({ className, ...props }, ref) => <input ref={ref} className={cn("h-10 w-full rounded-lg border border-white/10 bg-[#080c11] px-3 text-sm text-slate-100 placeholder:text-slate-600 outline-none transition focus:border-emerald-400/50 focus:ring-2 focus:ring-emerald-400/10", className)} {...props} />);
Input.displayName = "Input";
export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("h-10 rounded-lg border border-white/10 bg-[#080c11] px-3 text-sm text-slate-200 outline-none transition focus:border-emerald-400/50", className)} {...props}>{children}</select>;
}
