import { Bell, Monitor, Palette, Plug, Settings, SlidersHorizontal } from "lucide-react"
import type { ReactNode } from "react"
import { useSettingsStore } from "../store/settingsStore"

interface SettingsPanelProps {
  open: boolean
}

const intervals = [1, 3, 5, 10, 15, 30] as const

export function SettingsPanel({ open }: SettingsPanelProps) {
  const { settings, updateSettings } = useSettingsStore()
  if (!open) return null

  return (
    <aside className="no-scrollbar max-h-full overflow-y-auto rounded-[8px] border border-white/10 bg-[hsl(var(--color-panel-strong)/0.86)] p-4">
      <div className="mb-4 flex items-center gap-2 text-sm font-semibold">
        <Settings className="size-4" />
        Settings
      </div>

      <Section icon={<Monitor className="size-4" />} title="General">
        <label className="field">
          <span>Refresh interval</span>
          <select
            value={settings.refreshIntervalMinutes}
            onChange={(event) => updateSettings({ refreshIntervalMinutes: Number(event.target.value) as typeof settings.refreshIntervalMinutes })}
          >
            {intervals.map((interval) => (
              <option key={interval} value={interval}>
                {interval} min
              </option>
            ))}
          </select>
        </label>
        <Toggle label="Minimize to tray" checked={settings.minimizeToTray} onChange={(minimizeToTray) => updateSettings({ minimizeToTray })} />
        <Toggle label="Launch at startup" checked={settings.launchAtStartup} onChange={(launchAtStartup) => updateSettings({ launchAtStartup })} />
      </Section>

      <Section icon={<Plug className="size-4" />} title="Providers">
        <ProviderRow name="Claude" status={settings.demoMode ? "Demo connected" : "Unverified"} />
        <ProviderRow name="Codex" status={settings.demoMode ? "Demo connected" : "No stable source"} />
        <ProviderRow name="ChatGPT" status={settings.demoMode ? "Demo connected" : "Unavailable"} />
      </Section>

      <Section icon={<SlidersHorizontal className="size-4" />} title="Widget">
        <Toggle label="Always on top" checked={settings.alwaysOnTop} onChange={(alwaysOnTop) => updateSettings({ alwaysOnTop })} />
        <Toggle label="Lock position" checked={settings.lockPosition} onChange={(lockPosition) => updateSettings({ lockPosition })} />
        <Toggle label="Snap to edge" checked={settings.snapToEdge} onChange={(snapToEdge) => updateSettings({ snapToEdge })} />
        <Toggle label="Hide from taskbar" checked={settings.hideFromTaskbar} onChange={(hideFromTaskbar) => updateSettings({ hideFromTaskbar })} />
      </Section>

      <Section icon={<Palette className="size-4" />} title="Appearance">
        <label className="field">
          <span>Opacity</span>
          <input
            type="range"
            min="70"
            max="100"
            value={Math.round(settings.opacity * 100)}
            onChange={(event) => updateSettings({ opacity: Number(event.target.value) / 100 })}
          />
        </label>
        <Toggle label="Background blur" checked={settings.backgroundBlur} onChange={(backgroundBlur) => updateSettings({ backgroundBlur })} />
      </Section>

      <Section icon={<Bell className="size-4" />} title="Notifications">
        <Toggle label="Enabled" checked={settings.notificationsEnabled} onChange={(notificationsEnabled) => updateSettings({ notificationsEnabled })} />
      </Section>

      <Section icon={<Settings className="size-4" />} title="Advanced">
        <Toggle label="Demo mode" checked={settings.demoMode} onChange={(demoMode) => updateSettings({ demoMode })} />
        <Toggle label="Debug logs" checked={settings.debugLogs} onChange={(debugLogs) => updateSettings({ debugLogs })} />
        <Toggle
          label="Experimental providers"
          checked={settings.experimentalProviders}
          onChange={(experimentalProviders) => updateSettings({ experimentalProviders })}
        />
      </Section>
    </aside>
  )
}

function Section({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="mb-5 space-y-2 last:mb-0">
      <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-normal text-[hsl(var(--color-muted))]">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-4 text-sm text-[hsl(var(--color-text))]">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

function ProviderRow({ name, status }: { name: string; status: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span>{name}</span>
      <span className="text-xs text-[hsl(var(--color-muted))]">{status}</span>
    </div>
  )
}
