import { useEffect, useRef, type ReactNode } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Accessible modal dialog shell. Provides the role=dialog/aria-modal semantics, moves focus
 * into the dialog on open and restores it to the trigger on close, traps Tab within the
 * dialog, and closes on Escape / backdrop click when `dismissable`. A non-dismissable modal
 * (e.g. the first-run disclaimer gate) still traps focus but can't be dismissed by Esc/backdrop.
 */
export function Modal({
  onClose,
  labelledBy,
  className,
  dismissable = true,
  children
}: {
  onClose: () => void
  labelledBy?: string
  className?: string
  dismissable?: boolean
  children: ReactNode
}): JSX.Element {
  const dialogRef = useRef<HTMLDivElement>(null)
  const restoreRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    restoreRef.current = document.activeElement as HTMLElement | null
    const node = dialogRef.current
    const focusables = (): HTMLElement[] =>
      node ? Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.offsetParent !== null) : []
    // Move focus into the dialog (first field/button, else the dialog itself).
    ;(focusables()[0] ?? node)?.focus()

    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape' && dismissable) {
        e.stopPropagation()
        onClose()
        return
      }
      if (e.key !== 'Tab') return
      const f = focusables()
      if (f.length === 0) {
        e.preventDefault()
        return
      }
      const i = f.indexOf(document.activeElement as HTMLElement)
      if (e.shiftKey && i <= 0) {
        e.preventDefault()
        f[f.length - 1].focus()
      } else if (!e.shiftKey && i === f.length - 1) {
        e.preventDefault()
        f[0].focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      restoreRef.current?.focus?.()
    }
  }, [onClose, dismissable])

  return (
    <div className="modal-backdrop" onClick={dismissable ? onClose : undefined}>
      <div
        ref={dialogRef}
        className={className ? `modal ${className}` : 'modal'}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  )
}
