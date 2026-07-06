import { useEffect, useRef, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react'

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/** Props the caller spreads onto its trigger button so the popover can drive it. */
export interface PopoverTriggerProps {
  ref: (el: HTMLButtonElement | null) => void
  onClick: (e: React.MouseEvent) => void
  onKeyDown: (e: ReactKeyboardEvent) => void
  'aria-haspopup': 'menu'
  'aria-expanded': boolean
}

/**
 * A lightweight anchored popover — not a backdrop dialog (see Modal for that). The open flag is
 * owned by the PARENT so only one popover in a group is open at a time and hover-switching between
 * triggers needs no cross-component signalling. The trigger button and the panel live inside one
 * `.facet` wrapper that is the shared hover region, so moving the cursor from button into the panel
 * never fires `mouseleave` (no flicker).
 *
 * Interaction: hover opens (and closes after `closeDelayMs` on leave); clicking the trigger pins it
 * open until an outside click / Escape / a selection closes it. Keyboard (Enter/Space/ArrowDown)
 * opens and moves focus into the panel; Escape closes and returns focus to the trigger. Hover never
 * steals focus, so the keyboard/screen-reader path is unaffected by it.
 */
export function Popover({
  open,
  onOpen,
  onClose,
  trigger,
  children,
  labelledBy,
  closeDelayMs = 120
}: {
  open: boolean
  onOpen: () => void
  onClose: () => void
  trigger: (args: { open: boolean; triggerProps: PopoverTriggerProps }) => ReactNode
  children: ReactNode
  labelledBy?: string
  closeDelayMs?: number
}): JSX.Element {
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pinned = useRef(false) // set on click; suppresses the mouse-leave close
  const openedByKeyboard = useRef(false)

  const clearCloseTimer = (): void => {
    if (closeTimer.current) {
      clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  // Outside-click + Escape while open. Escape returns focus to the trigger (mirrors Modal).
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: PointerEvent): void {
      if (!wrapperRef.current?.contains(e.target as Node)) onClose()
    }
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') {
        e.stopPropagation()
        onClose()
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose])

  // On open: focus the first panel item only when opened by keyboard (hover must not steal focus).
  // On close: reset the transient pin/keyboard flags and any pending timer.
  useEffect(() => {
    if (open) {
      if (openedByKeyboard.current) {
        const first = panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)
        first?.focus()
      }
    } else {
      pinned.current = false
      openedByKeyboard.current = false
      clearCloseTimer()
    }
  }, [open])

  useEffect(() => clearCloseTimer, [])

  const triggerProps: PopoverTriggerProps = {
    ref: (el) => {
      triggerRef.current = el
    },
    onClick: () => {
      if (open) {
        onClose()
      } else {
        pinned.current = true
        openedByKeyboard.current = false
        onOpen()
      }
    },
    onKeyDown: (e) => {
      if (e.key === 'Enter' || e.key === ' ' || e.key === 'ArrowDown') {
        e.preventDefault()
        if (!open) {
          openedByKeyboard.current = true
          onOpen()
        }
      }
    },
    'aria-haspopup': 'menu',
    'aria-expanded': open
  }

  // Roving focus between panel items for keyboard users.
  function onPanelKeyDown(e: ReactKeyboardEvent): void {
    const items = panelRef.current
      ? Array.from(panelRef.current.querySelectorAll<HTMLElement>(FOCUSABLE))
      : []
    if (items.length === 0) return
    const i = items.indexOf(document.activeElement as HTMLElement)
    if (e.key === 'ArrowDown' || e.key === 'ArrowRight') {
      e.preventDefault()
      items[(i + 1) % items.length].focus()
    } else if (e.key === 'ArrowUp' || e.key === 'ArrowLeft') {
      e.preventDefault()
      items[(i - 1 + items.length) % items.length].focus()
    } else if (e.key === 'Home') {
      e.preventDefault()
      items[0].focus()
    } else if (e.key === 'End') {
      e.preventDefault()
      items[items.length - 1].focus()
    }
  }

  return (
    <div
      ref={wrapperRef}
      className="facet"
      onMouseEnter={() => {
        clearCloseTimer()
        if (!open) onOpen()
      }}
      onMouseLeave={() => {
        if (pinned.current) return
        clearCloseTimer()
        closeTimer.current = setTimeout(onClose, closeDelayMs)
      }}
    >
      {trigger({ open, triggerProps })}
      {open && (
        <div
          ref={panelRef}
          className="facet-panel"
          role="menu"
          aria-labelledby={labelledBy}
          onKeyDown={onPanelKeyDown}
        >
          {children}
        </div>
      )}
    </div>
  )
}
