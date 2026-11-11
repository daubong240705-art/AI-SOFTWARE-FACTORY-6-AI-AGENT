import * as React from "react"
import { cn } from "@/lib/utils"
import { Progress as ProgressPrimitive } from "radix-ui"
import { motion, useReducedMotion } from "motion/react"

function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const reduced = useReducedMotion()
  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      className={cn(
        "relative h-2 w-full overflow-hidden rounded-full bg-primary/20",
        className
      )}
      {...props}
      {...(value === undefined ? {} : { value })}
    >
      <ProgressPrimitive.Indicator asChild>
      <motion.div
        data-slot="progress-indicator"
        className="h-full w-full flex-1 origin-left bg-primary"
        initial={reduced ? false : { scaleX: 0 }}
        animate={{ scaleX: Math.max(0, Math.min(100, value ?? 0)) / 100 }}
        transition={{ duration: reduced ? 0 : 0.5, ease: 'easeOut' }}
      />
      </ProgressPrimitive.Indicator>
    </ProgressPrimitive.Root>
  )
}

export { Progress }
