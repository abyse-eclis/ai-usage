import { useEffect, useState } from "react"

export function useContainerSize<T extends HTMLElement>() {
  const [element, setElement] = useState<T | null>(null)
  const [size, setSize] = useState({ width: 420, height: 560 })

  useEffect(() => {
    if (!element) return
    const observer = new ResizeObserver(([entry]) => {
      const rect = entry.contentRect
      setSize({ width: Math.round(rect.width), height: Math.round(rect.height) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [element])

  return { ref: setElement, size }
}
