import { Widget } from "../features/widget/components/Widget"
import { TaskbarCompanion } from "../features/taskbar-companion/components/TaskbarCompanion"

export function App() {
  if (window.location.pathname === "/companion") return <TaskbarCompanion />
  return <Widget />
}
