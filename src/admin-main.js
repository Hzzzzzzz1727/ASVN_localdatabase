import './assets/main.css'
import 'bootstrap/dist/css/bootstrap.min.css'
import 'bootstrap'

import { createApp } from 'vue'
import AdminWorkspace from './AdminWorkspace.vue'

const installSingleClickGuard = (lockMs = 1200) => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return

  const lockedUntil = new WeakMap()
  const stateCache = new WeakMap()
  const selector = 'button, [role="button"], .btn, .chip-wh, .media-del'

  const resolveTarget = (node) => {
    if (!(node instanceof Element)) return null
    return node.closest(selector)
  }

  const restoreTarget = (target) => {
    const state = stateCache.get(target)
    if (!state) return

    if (state.hadDisabledProp) {
      target.disabled = state.disabled
    }

    if (state.pointerEvents !== undefined) {
      target.style.pointerEvents = state.pointerEvents
    } else {
      target.style.removeProperty('pointer-events')
    }

    target.removeAttribute('data-single-click-locked')
    stateCache.delete(target)
  }

  document.addEventListener('click', (event) => {
    const target = resolveTarget(event.target)
    if (!target || target.dataset.allowRepeatClick === 'true') return

    const now = Date.now()
    const currentLock = lockedUntil.get(target) || 0
    if (currentLock > now) {
      event.preventDefault()
      event.stopPropagation()
      event.stopImmediatePropagation?.()
      return
    }

    lockedUntil.set(target, now + lockMs)
    stateCache.set(target, {
      hadDisabledProp: 'disabled' in target,
      disabled: 'disabled' in target ? target.disabled : undefined,
      pointerEvents: target.style.pointerEvents || undefined,
    })

    if ('disabled' in target) {
      target.disabled = true
    }
    target.style.pointerEvents = 'none'
    target.setAttribute('data-single-click-locked', 'true')

    window.setTimeout(() => {
      restoreTarget(target)
    }, lockMs)
  }, true)
}

installSingleClickGuard()

createApp(AdminWorkspace).mount('#app')
