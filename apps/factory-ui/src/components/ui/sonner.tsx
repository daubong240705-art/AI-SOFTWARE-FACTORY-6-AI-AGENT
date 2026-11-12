"use client"

import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  // The app resolves light/dark itself (src/i18n applyTheme) and mirrors it in data-theme.
  const theme = typeof document !== "undefined" && document.documentElement.dataset.theme === "light" ? "light" : "dark"

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast: "flex w-full items-center gap-3 rounded-xl border border-border bg-card p-4 text-foreground shadow-lg",
          title: "text-sm font-medium",
          description: "text-xs text-muted-foreground",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
