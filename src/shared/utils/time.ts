export function addDuration(date: Date, duration: { hours?: number; minutes?: number; days?: number }) {
  const next = new Date(date)
  next.setMinutes(next.getMinutes() + (duration.minutes ?? 0))
  next.setHours(next.getHours() + (duration.hours ?? 0))
  next.setDate(next.getDate() + (duration.days ?? 0))
  return next.toISOString()
}

export function formatClock(iso: string) {
  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(iso))
}

export function formatResetCountdown(resetAt?: string, now = new Date()) {
  if (!resetAt) return undefined
  const diffMs = new Date(resetAt).getTime() - now.getTime()
  if (Number.isNaN(diffMs)) return undefined
  if (diffMs <= 0) return "Ready to refresh"

  const totalMinutes = Math.ceil(diffMs / 60000)
  const days = Math.floor(totalMinutes / 1440)
  const hours = Math.floor((totalMinutes % 1440) / 60)
  const minutes = totalMinutes % 60

  if (days > 0) return `Resets in ${days}d ${hours}h`
  if (hours > 0) return `Resets in ${hours}h ${minutes.toString().padStart(2, "0")}m`
  return `Resets in ${minutes}m`
}
