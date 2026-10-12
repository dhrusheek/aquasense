import { cn } from "cn"

function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("rounded-md bg-ink-4 [animation:aq-skel_1.6s_ease-in-out_infinite]", className)}
      {...props}
    />
  )
}

export { Skeleton }
