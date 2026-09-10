export type DockSide = "left" | "right" | null

export interface EdgeDockState {
  isCollapsed: boolean
  dockSide: DockSide
  isAnimating: boolean
}
