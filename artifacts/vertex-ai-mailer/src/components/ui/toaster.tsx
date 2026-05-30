import { useToast } from "@/hooks/use-toast"
import {
  Toast, ToastClose, ToastDescription, ToastProvider,
  ToastTitle, ToastViewport,
} from "@/components/ui/toast"
import { CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react"

function VariantIcon({ variant }: { variant?: string }) {
  switch (variant) {
    case "success":
      return (
        <div className="flex-shrink-0 mt-0.5">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
        </div>
      )
    case "warning":
      return (
        <div className="flex-shrink-0 mt-0.5">
          <AlertTriangle className="h-4 w-4 text-amber-500" />
        </div>
      )
    case "destructive":
      return (
        <div className="flex-shrink-0 mt-0.5">
          <XCircle className="h-4 w-4 text-red-500" />
        </div>
      )
    case "info":
      return (
        <div className="flex-shrink-0 mt-0.5">
          <Info className="h-4 w-4 text-blue-500" />
        </div>
      )
    default:
      return null
  }
}

export function Toaster() {
  const { toasts } = useToast()

  return (
    <ToastProvider duration={4500}>
      {toasts.map(function ({ id, title, description, action, variant, ...props }) {
        return (
          <Toast key={id} variant={variant} {...props}>
            <VariantIcon variant={variant} />
            <div className="flex-1 min-w-0">
              {title && <ToastTitle>{title}</ToastTitle>}
              {description && <ToastDescription>{description}</ToastDescription>}
            </div>
            {action}
            <ToastClose />
          </Toast>
        )
      })}
      <ToastViewport />
    </ToastProvider>
  )
}
