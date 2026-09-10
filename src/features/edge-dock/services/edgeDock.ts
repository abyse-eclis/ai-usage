import { invoke } from "@tauri-apps/api/core"
import type { DockSide, EdgeDockState } from "../types/edgeDock"

export async function getEdgeDockState() {
  return invoke<EdgeDockState>("get_edge_dock_state")
}

export async function collapseToEdge(side?: Exclude<DockSide, null>) {
  return invoke<EdgeDockState>("collapse_to_edge", { side })
}

export async function expandFromEdge() {
  return invoke<EdgeDockState>("expand_from_edge")
}

export async function setDockSide(side: Exclude<DockSide, null>) {
  return invoke<EdgeDockState>("set_dock_side", { side })
}

export async function undockWidget() {
  return invoke<EdgeDockState>("undock_widget")
}
