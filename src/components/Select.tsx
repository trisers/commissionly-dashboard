import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react'
import { createPortal } from 'react-dom'
import './Select.css'

export type SelectOption<T extends string | number> = {
  value: T
  label: string
}

type SelectProps<T extends string | number> = {
  options: SelectOption<T>[]
  value: T
  onChange: (value: T) => void
  /** Accessible name (shown to screen readers; use `label` for a visible one). */
  ariaLabel?: string
  /** Visible label rendered before the trigger, e.g. "Rows per page". */
  label?: string
  /** Icon shown inside the trigger, before the selected text. */
  icon?: ReactNode
  /** "default" = bordered field; "ghost" = borderless (inside another control). */
  variant?: 'default' | 'ghost'
  size?: 'sm' | 'md'
  /** Stretch the trigger to the container width. */
  fullWidth?: boolean
  disabled?: boolean
  className?: string
}

const MENU_GAP = 6
const VIEWPORT_MARGIN = 8

/**
 * Custom dropdown that replaces the native <select>: consistent styling in
 * light/dark mode, keyboard support (arrows, Home/End, Enter, Esc, type to
 * jump) and a menu that stays on screen (opens upward near the bottom, aligns
 * right near the right edge). The menu is portaled to <body> so card or table
 * overflow never clips it.
 */
export function Select<T extends string | number>({
  options,
  value,
  onChange,
  ariaLabel,
  label,
  icon,
  variant = 'default',
  size = 'md',
  fullWidth = false,
  disabled = false,
  className = '',
}: SelectProps<T>) {
  const id = useId()
  const listboxId = `${id}-listbox`
  const labelId = `${id}-label`
  const triggerRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLUListElement>(null)
  const typeaheadRef = useRef({ text: '', timer: 0 })
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [position, setPosition] = useState<{ top: number; left: number; minWidth: number } | null>(
    null
  )

  const selectedIndex = options.findIndex((option) => option.value === value)
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null

  const openMenu = useCallback(
    (index?: number) => {
      if (disabled) return
      setActiveIndex(index ?? (selectedIndex >= 0 ? selectedIndex : 0))
      setPosition(null)
      setOpen(true)
    },
    [disabled, selectedIndex]
  )

  const closeMenu = useCallback((focusTrigger = true) => {
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }, [])

  const choose = (index: number) => {
    const option = options[index]
    if (!option) return
    if (option.value !== value) onChange(option.value)
    closeMenu()
  }

  // Place the menu under the trigger, or above it when there isn't room below.
  const updatePosition = useCallback(() => {
    const trigger = triggerRef.current
    const menu = menuRef.current
    if (!trigger || !menu) return
    const rect = trigger.getBoundingClientRect()
    const menuHeight = menu.offsetHeight
    const menuWidth = Math.max(menu.offsetWidth, rect.width)
    const spaceBelow = window.innerHeight - rect.bottom
    const openUp = spaceBelow < menuHeight + MENU_GAP + VIEWPORT_MARGIN && rect.top > spaceBelow
    const top = openUp ? rect.top - menuHeight - MENU_GAP : rect.bottom + MENU_GAP
    let left = rect.left
    if (left + menuWidth > window.innerWidth - VIEWPORT_MARGIN) {
      left = Math.max(VIEWPORT_MARGIN, rect.right - menuWidth)
    }
    setPosition({ top: Math.max(VIEWPORT_MARGIN, top), left, minWidth: rect.width })
  }, [])

  useLayoutEffect(() => {
    if (open) updatePosition()
  }, [open, updatePosition])

  useEffect(() => {
    if (!open) return
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      closeMenu(false)
    }
    const handleScrollOrResize = () => updatePosition()
    document.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('resize', handleScrollOrResize)
    window.addEventListener('scroll', handleScrollOrResize, true)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('resize', handleScrollOrResize)
      window.removeEventListener('scroll', handleScrollOrResize, true)
    }
  }, [open, closeMenu, updatePosition])

  // Keep the active option scrolled into view.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    const node = menuRef.current?.children[activeIndex] as HTMLElement | undefined
    node?.scrollIntoView({ block: 'nearest' })
  }, [open, activeIndex])

  // Type a letter to jump to the next option starting with it.
  const typeahead = (key: string) => {
    const state = typeaheadRef.current
    window.clearTimeout(state.timer)
    state.text += key.toLowerCase()
    state.timer = window.setTimeout(() => {
      state.text = ''
    }, 500)
    const start = open ? activeIndex + 1 : selectedIndex + 1
    for (let i = 0; i < options.length; i++) {
      const index = (start + i) % options.length
      if (options[index].label.toLowerCase().startsWith(state.text)) {
        if (open) setActiveIndex(index)
        else openMenu(index)
        return
      }
    }
  }

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (disabled) return
    const last = options.length - 1
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!open) openMenu()
        else setActiveIndex((i) => Math.min(last, i + 1))
        break
      case 'ArrowUp':
        event.preventDefault()
        if (!open) openMenu()
        else setActiveIndex((i) => Math.max(0, i - 1))
        break
      case 'Home':
        if (open) {
          event.preventDefault()
          setActiveIndex(0)
        }
        break
      case 'End':
        if (open) {
          event.preventDefault()
          setActiveIndex(last)
        }
        break
      case 'Enter':
      case ' ':
        event.preventDefault()
        if (open) choose(activeIndex)
        else openMenu()
        break
      case 'Escape':
        if (open) {
          event.preventDefault()
          closeMenu()
        }
        break
      case 'Tab':
        if (open) closeMenu(false)
        break
      default:
        if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          typeahead(event.key)
        }
    }
  }

  const classes = [
    'ui-select',
    `ui-select-${variant}`,
    `ui-select-${size}`,
    fullWidth ? 'ui-select-full' : '',
    open ? 'is-open' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return (
    <div className={classes}>
      {label && (
        <span id={labelId} className="ui-select-label">
          {label}
        </span>
      )}
      <button
        ref={triggerRef}
        type="button"
        className="ui-select-trigger"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={open && activeIndex >= 0 ? `${id}-option-${activeIndex}` : undefined}
        aria-label={label ? undefined : ariaLabel}
        aria-labelledby={label ? `${labelId} ${id}-value` : undefined}
        disabled={disabled}
        onClick={() => (open ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
      >
        {icon && <span className="ui-select-icon">{icon}</span>}
        <span id={`${id}-value`} className="ui-select-value">
          {selected?.label ?? ''}
        </span>
        <svg
          className="ui-select-chevron"
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>

      {open &&
        createPortal(
          <ul
            ref={menuRef}
            id={listboxId}
            role="listbox"
            aria-label={label ?? ariaLabel}
            className={`ui-select-menu ui-select-menu-${size}`}
            style={{
              top: position?.top ?? 0,
              left: position?.left ?? 0,
              minWidth: position?.minWidth,
              // Measured first, then shown in place (avoids a jump).
              visibility: position ? 'visible' : 'hidden',
            }}
          >
            {options.map((option, index) => {
              const isSelected = option.value === value
              return (
                <li
                  key={String(option.value)}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={isSelected}
                  className={[
                    'ui-select-option',
                    isSelected ? 'is-selected' : '',
                    index === activeIndex ? 'is-active' : '',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                  onPointerEnter={() => setActiveIndex(index)}
                  onPointerDown={(event) => event.preventDefault()}
                  onClick={() => choose(index)}
                >
                  <span className="ui-select-option-label">{option.label}</span>
                  {isSelected && (
                    <svg
                      className="ui-select-check"
                      width="16"
                      height="16"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      aria-hidden="true"
                    >
                      <path d="M20 6L9 17l-5-5" />
                    </svg>
                  )}
                </li>
              )
            })}
          </ul>,
          document.body
        )}
    </div>
  )
}
