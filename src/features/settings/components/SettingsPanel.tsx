import { Bell, LayoutPanelLeft, Monitor, Palette, Plug, Settings, SlidersHorizontal, TerminalSquare } from "lucide-react"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import {
  listTaskbars,
  setTaskbarMonitor,
  type TaskbarInfo
} from "../../taskbar-companion/services/taskbarCompanionWindow"
import {
  hideEdgeDock,
  hideTaskbarCompanion,
  setMainWidgetStartupEnabled,
  showEdgeDock,
  showTaskbarCompanion
} from "../../window-manager/services/windowManager"
import { useSettingsStore } from "../store/settingsStore"

interface SettingsPanelProps {
  open: boolean
}

const intervals = [1, 3, 5, 10, 15, 30] as const

export function SettingsPanel({ open }: SettingsPanelProps) {
  const { settings, updateSettings } = useSettingsStore()
  const [taskbars, setTaskbars] = useState<TaskbarInfo[]>([])

  useEffect(() => {
    if (!open) return
    listTaskbars().then(setTaskbars).catch(() => undefined)
  }, [open])

  if (!open) return null

  return (
    <aside className="no-scrollbar h-full overflow-y-auto rounded-[8px] border border-white/10 bg-[hsl(var(--color-panel-strong)/0.96)] p-2.5 shadow-[0_12px_28px_rgb(0_0_0/0.3)]">
      <div className="mb-2.5 flex items-center gap-1.5 text-xs font-semibold">
        <Settings className="size-3.5" />
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

      <Section icon={<TerminalSquare className="size-4" />} title="Reload commands">
        <p className="text-[10px] leading-snug text-[hsl(var(--color-muted))]">
          Usage numbers are read from files the CLIs write. A CLI only writes them while handling a
          real request, so these commands spend quota. They run on the reload button only, never on
          the refresh interval. Leave empty to just re-read the files.
        </p>
        <label className="field">
          <span>Claude</span>
          <input
            type="text"
            spellCheck={false}
            placeholder="e.g. claude -p ok"
            value={settings.cliRefresh.claudeCommand}
            onChange={(event) =>
              updateSettings({ cliRefresh: { ...settings.cliRefresh, claudeCommand: event.target.value } })
            }
          />
        </label>
        <label className="field">
          <span>Codex</span>
          <input
            type="text"
            spellCheck={false}
            placeholder="e.g. codex exec ok"
            value={settings.cliRefresh.codexCommand}
            onChange={(event) =>
              updateSettings({ cliRefresh: { ...settings.cliRefresh, codexCommand: event.target.value } })
            }
          />
        </label>
      </Section>

      <Section icon={<LayoutPanelLeft className="size-4" />} title="Presentation">
        <Toggle
          label="Taskbar Companion"
          checked={settings.presentation.taskbarCompanionEnabled}
          onChange={(enabled) => {
            updateSettings({ presentation: { ...settings.presentation, taskbarCompanionEnabled: enabled } })
            if (enabled) showTaskbarCompanion()
            else hideTaskbarCompanion()
          }}
        />
        <Toggle
          label="Main Widget on startup"
          checked={settings.presentation.mainWidgetEnabled}
          onChange={(enabled) => {
            updateSettings({ presentation: { ...settings.presentation, mainWidgetEnabled: enabled } })
            setMainWidgetStartupEnabled(enabled)
          }}
        />
        <Toggle
          label="Edge Dock"
          checked={settings.presentation.edgeDockEnabled}
          onChange={(enabled) => {
            updateSettings({ presentation: { ...settings.presentation, edgeDockEnabled: enabled } })
            if (enabled) showEdgeDock()
            else hideEdgeDock()
          }}
        />
      </Section>

      <Section icon={<SlidersHorizontal className="size-4" />} title="Widget">
        <Toggle label="Always on top" checked={settings.alwaysOnTop} onChange={(alwaysOnTop) => updateSettings({ alwaysOnTop })} />
        <Toggle label="Lock position" checked={settings.lockPosition} onChange={(lockPosition) => updateSettings({ lockPosition })} />
        <Toggle label="Snap to edge" checked={settings.snapToEdge} onChange={(snapToEdge) => updateSettings({ snapToEdge })} />
        <Toggle
          label="Auto collapse when docked"
          checked={settings.autoCollapseWhenDocked}
          onChange={(autoCollapseWhenDocked) => updateSettings({ autoCollapseWhenDocked })}
        />
        <Toggle label="Hide from taskbar" checked={settings.hideFromTaskbar} onChange={(hideFromTaskbar) => updateSettings({ hideFromTaskbar })} />
      </Section>

      <Section icon={<Monitor className="size-4" />} title="Taskbar Companion">
        <ProviderRow name="Primary Provider" status="Claude" />
        <label className="field">
          <span>Monitor</span>
          <select
            value={settings.taskbarCompanion.taskbarMonitorId}
            onChange={(event) => {
              const taskbarMonitorId = event.target.value
              updateSettings({ taskbarCompanion: { ...settings.taskbarCompanion, taskbarMonitorId } })
              setTaskbarMonitor(taskbarMonitorId)
            }}
          >
            <option value="">Primary</option>
            {taskbars.map((taskbar) => (
              <option key={taskbar.monitorId} value={taskbar.monitorId}>
                {taskbar.monitorId.replace(/^\\\\[.]\\/, "")}
              </option>
            ))}
          </select>
        </label>
        <ProviderRow name="Display" status="Claude 45% 23:00" />
        <label className="field">
          <span>Time format</span>
          <select
            value={settings.taskbarCompanion.timeFormat}
            onChange={(event) =>
              updateSettings({
                taskbarCompanion: {
                  ...settings.taskbarCompanion,
                  timeFormat: event.target.value as typeof settings.taskbarCompanion.timeFormat
                }
              })
            }
          >
            <option value="24-hour">24-hour</option>
            <option value="12-hour">12-hour</option>
          </select>
        </label>
        <Toggle
          label="Hover popup"
          checked={settings.taskbarCompanion.hoverPopupEnabled}
          onChange={(hoverPopupEnabled) =>
            updateSettings({ taskbarCompanion: { ...settings.taskbarCompanion, hoverPopupEnabled } })
          }
        />
        <Toggle
          label="Click to pin"
          checked={settings.taskbarCompanion.clickToPinEnabled}
          onChange={(clickToPinEnabled) =>
            updateSettings({ taskbarCompanion: { ...settings.taskbarCompanion, clickToPinEnabled } })
          }
        />
        <Toggle
          label="5h"
          checked={settings.taskbarCompanion.showFiveHour}
          onChange={(showFiveHour) => updateSettings({ taskbarCompanion: { ...settings.taskbarCompanion, showFiveHour } })}
        />
        <Toggle
          label="Weekly"
          checked={settings.taskbarCompanion.showWeekly}
          onChange={(showWeekly) => updateSettings({ taskbarCompanion: { ...settings.taskbarCompanion, showWeekly } })}
        />
        <Toggle
          label="Fable"
          checked={settings.taskbarCompanion.showFable}
          onChange={(showFable) => updateSettings({ taskbarCompanion: { ...settings.taskbarCompanion, showFable } })}
        />
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
    <section className="mb-3 space-y-1.5 last:mb-0">
      <h3 className="flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-normal text-[hsl(var(--color-muted))]">
        {icon}
        {title}
      </h3>
      {children}
    </section>
  )
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-[11px] text-[hsl(var(--color-text))]">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  )
}

function ProviderRow({ name, status }: { name: string; status: string }) {
  return (
    <div className="flex items-center justify-between gap-3 text-[11px]">
      <span>{name}</span>
      <span className="truncate text-[10px] text-[hsl(var(--color-muted))]">{status}</span>
    </div>
  )
}
