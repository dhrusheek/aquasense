import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Toggle as TogglePrimitive } from "radix-ui"

const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-full border border-transparent bg-transparent font-sans text-[13px] font-medium whitespace-nowrap transition-colors hover:bg-ink-4 hover:text-foreground disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-pressed:border-ink-3 aria-pressed:bg-card aria-pressed:text-foreground data-[state=on]:border-ink-3 data-[state=on]:bg-card data-[state=on]:text-foreground data-[state=on]:hover:bg-card [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default: "",
        outline: "",
      },
      size: {
        default:
          "h-10 min-w-10 px-4 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-[34px] min-w-8 px-3.5 text-[13px] has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-10 min-w-10 px-4 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: React.ComponentProps<typeof TogglePrimitive.Root> &
  VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive.Root
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
