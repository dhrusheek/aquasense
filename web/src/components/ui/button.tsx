import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border bg-origin-border font-sans text-sm leading-5 font-medium whitespace-nowrap transition-colors select-none disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "border-foreground bg-foreground text-primary-foreground hover:bg-foreground/85",
        outline:
          "border-ink-3 bg-card text-foreground hover:bg-ink-4 aria-expanded:bg-ink-4",
        secondary:
          "border-ink-3 bg-card text-secondary-foreground hover:bg-ink-4 aria-expanded:bg-ink-4",
        ghost:
          "border-transparent hover:bg-ink-4 hover:text-foreground aria-expanded:bg-ink-4 aria-expanded:text-foreground",
        destructive:
          "border-bad bg-card text-bad-ink hover:bg-bad/10",
        link: "border-transparent text-foreground underline underline-offset-4 hover:bg-ink-4",
      },
      size: {
        default:
          "h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        xs: "h-7 gap-1 px-2.5 text-xs in-data-[slot=button-group]:rounded-full has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-[34px] gap-1.5 px-3.5 text-[13px] in-data-[slot=button-group]:rounded-full has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 gap-2 px-4 has-data-[icon=inline-end]:pr-3 has-data-[icon=inline-start]:pl-3",
        icon: "size-10",
        "icon-xs":
          "size-7 in-data-[slot=button-group]:rounded-full [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-[34px] in-data-[slot=button-group]:rounded-full",
        "icon-lg": "size-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  asChild = false,
  ...props
}: React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }) {
  const Comp = asChild ? Slot.Root : "button"

  return (
    <Comp
      data-slot="button"
      data-variant={variant}
      data-size={size}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
