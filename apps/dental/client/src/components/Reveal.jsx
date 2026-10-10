import React, { useEffect, useRef } from 'react'

// Reveal — adds .is-in to its child wrapper when it scrolls into view.
// Everything with .reveal starts hidden (opacity 0 + rise) and animates in once.
// Falls back to instantly visible if IntersectionObserver is missing.
export default function Reveal({ children, delay = 0, className = '', as: Tag = 'div', ...rest }) {
  const ref = useRef(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    if (typeof IntersectionObserver === 'undefined') { el.classList.add('is-in'); return }
    const io = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (e.isIntersecting) {
          // stagger within the same observer batch
          const siblings = [...(e.target.parentElement?.querySelectorAll('.reveal:not(.is-in)') || [])]
          siblings.forEach((s, i) => setTimeout(() => s.classList.add('is-in'), siblings.length > 1 ? i * 90 : 0))
          io.disconnect()
        }
      }
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <Tag ref={ref} className={`reveal ${className}`} style={delay ? { '--reveal-delay': `${delay}ms` } : undefined} {...rest}>
      {children}
    </Tag>
  )
}
