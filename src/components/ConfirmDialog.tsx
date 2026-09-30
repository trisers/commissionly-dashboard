import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './ConfirmDialog.css'

type ConfirmDialogProps = {
  open: boolean
  title: string
  message?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  /** "danger" = red confirm button (logout, delete…); "primary" = brand color. */
  tone?: 'danger' | 'primary'
  /** Optional icon shown above the title. */
  icon?: ReactNode
  /** Disables the buttons and shows `loadingLabel` on the confirm button. */
  loading?: boolean
  loadingLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

/**
 * Reusable confirmation dialog: "Are you sure?" with Cancel / Confirm.
 * Closes on Cancel, Escape or a click outside (not while `loading`).
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'primary',
  icon,
  loading = false,
  loadingLabel = 'Please wait...',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const titleId = useId()
  const messageId = useId()
  const cancelRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  // Latest callbacks/state for the key handler, so the effect below runs only
  // when the dialog opens/closes (not on every parent re-render).
  const onCancelRef = useRef(onCancel)
  const loadingRef = useRef(loading)
  useEffect(() => {
    onCancelRef.current = onCancel
    loadingRef.current = loading
  })

  useEffect(() => {
    if (!open) return

    // Focus Cancel so Enter doesn't confirm by accident; restore focus on close.
    const previouslyFocused = document.activeElement as HTMLElement | null
    cancelRef.current?.focus()

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !loadingRef.current) {
        event.preventDefault()
        onCancelRef.current()
        return
      }
      // Keep Tab focus inside the dialog.
      if (event.key === 'Tab' && dialogRef.current) {
        const focusable = dialogRef.current.querySelectorAll<HTMLElement>('button:not(:disabled)')
        if (focusable.length === 0) return
        const first = focusable[0]
        const last = focusable[focusable.length - 1]
        if (event.shiftKey && document.activeElement === first) {
          event.preventDefault()
          last.focus()
        } else if (!event.shiftKey && document.activeElement === last) {
          event.preventDefault()
          first.focus()
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus?.()
    }
  }, [open])

  if (!open) return null

  return createPortal(
    <div
      className="confirm-dialog-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !loading) onCancel()
      }}
    >
      <div
        ref={dialogRef}
        className={`confirm-dialog confirm-dialog-${tone}`}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={message ? messageId : undefined}
      >
        {icon && <div className="confirm-dialog-icon">{icon}</div>}
        <h3 id={titleId} className="confirm-dialog-title">
          {title}
        </h3>
        {message && (
          <div id={messageId} className="confirm-dialog-message">
            {message}
          </div>
        )}
        <div className="confirm-dialog-actions">
          <button
            ref={cancelRef}
            type="button"
            className="confirm-dialog-button confirm-dialog-cancel"
            onClick={onCancel}
            disabled={loading}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className="confirm-dialog-button confirm-dialog-confirm"
            onClick={onConfirm}
            disabled={loading}
          >
            {loading && <span className="confirm-dialog-spinner" aria-hidden="true" />}
            {loading ? loadingLabel : confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
