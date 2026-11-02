import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";

export const buttonVariants = cva(
  "btn-press inline-flex shrink-0 items-center justify-center gap-2 rounded-xl font-semibold whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      intent: {
        primary: "bg-nus-orange text-white shadow-card hover:bg-nus-orange-hover",
        secondary: "bg-nus-blue text-white shadow-card hover:bg-nus-blue-light",
        outline: "border border-border bg-background text-foreground hover:bg-surface",
        ghost: "text-muted hover:bg-surface hover:text-foreground",
        link: "px-0! py-0! text-nus-blue-ink hover:underline underline-offset-4",
        danger: "bg-danger text-white shadow-card hover:opacity-90",
        "danger-outline": "border border-danger/50 text-danger hover:bg-danger/10",
        success: "bg-success text-white shadow-card hover:opacity-90",
        "success-outline": "border border-success/50 text-success hover:bg-success/10",
        "blue-outline": "border border-nus-blue-ink/40 text-nus-blue-ink hover:bg-nus-blue-ink/10",
      },
      size: {
        xs: "h-7 px-2.5 text-xs rounded-lg pointer-coarse:h-9",
        sm: "h-9 px-3.5 text-sm pointer-coarse:h-10",
        md: "h-10 px-4 text-sm",
        lg: "h-11 px-5 text-sm",
      },
      block: { true: "w-full" },
    },
    defaultVariants: { intent: "primary", size: "md" },
  },
);

export type ButtonVariants = VariantProps<typeof buttonVariants>;

export function Button({
  intent,
  size,
  block,
  className,
  type = "button",
  ...props
}: React.ComponentProps<"button"> & ButtonVariants) {
  return (
    <button type={type} className={clsx(buttonVariants({ intent, size, block }), className)} {...props} />
  );
}
