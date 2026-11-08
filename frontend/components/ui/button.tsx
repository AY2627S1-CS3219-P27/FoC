import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";

// Pill buttons: filled for the main action, tinted for secondary ones, gray for neutral.
export const buttonVariants = cva(
  "btn-press inline-flex shrink-0 items-center justify-center gap-1.5 rounded-full font-semibold whitespace-nowrap select-none disabled:pointer-events-none disabled:opacity-40",
  {
    variants: {
      intent: {
        primary: "bg-nus-orange text-white hover:bg-nus-orange-hover",
        secondary: "bg-nus-blue text-white hover:bg-nus-blue-light",
        outline: "bg-fill text-foreground hover:bg-[color-mix(in_srgb,var(--fill)_160%,transparent)]",
        tinted: "bg-nus-orange/12 text-nus-orange hover:bg-nus-orange/18",
        ghost: "text-nus-orange hover:bg-nus-orange/10",
        link: "px-0! text-nus-orange hover:opacity-70",
        danger: "bg-danger text-white hover:opacity-90",
        "danger-outline": "bg-danger/10 text-danger hover:bg-danger/15",
        success: "bg-success text-white hover:opacity-90",
        "success-outline": "bg-success/12 text-success hover:bg-success/18",
        "blue-outline": "bg-nus-blue-ink/10 text-nus-blue-ink hover:bg-nus-blue-ink/15",
      },
      size: {
        xs: "h-7 px-3 text-xs pointer-coarse:h-9",
        sm: "h-8 px-3.5 text-[13px] pointer-coarse:h-10",
        md: "h-10 px-5 text-[15px]",
        lg: "h-12 px-6 text-[15px]",
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
