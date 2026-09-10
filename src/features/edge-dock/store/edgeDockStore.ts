import { create } from "zustand"
import type { DockSide, EdgeDockState } from "../types/edgeDock"
import { collapseToEdge, expandFromEdge, getEdgeDockState, setDockSide, undockWidget } from "../services/edgeDock"

interface EdgeDockStore extends EdgeDockState {
  hydrate: () => Promise<void>
  collapse: () => Promise<void>
  expand: () => Promise<void>
  toggle: () => Promise<void>
  dock: (side: Exclude<DockSide, null>) => Promise<void>
  undock: () => Promise<void>
  applyNativeState: (state: EdgeDockState) => void
}

const initialState: EdgeDockState = {
  isCollapsed: false,
  dockSide: null,
  isAnimating: false
}

export const useEdgeDockStore = create<EdgeDockStore>((set, get) => ({
  ...initialState,
  applyNativeState: (state) => set(state),
  hydrate: async () => {
    const state = await getEdgeDockState()
    set(state)
  },
  collapse: async () => {
    if (get().isAnimating) return
    set({ isAnimating: true })
    try {
      set(await collapseToEdge(get().dockSide ?? undefined))
    } finally {
      set({ isAnimating: false })
    }
  },
  expand: async () => {
    if (get().isAnimating) return
    set({ isAnimating: true })
    try {
      set(await expandFromEdge())
    } finally {
      set({ isAnimating: false })
    }
  },
  toggle: async () => {
    if (get().isCollapsed) {
      await get().expand()
      return
    }
    await get().collapse()
  },
  dock: async (side) => {
    if (get().isAnimating) return
    set({ isAnimating: true })
    try {
      set(await setDockSide(side))
    } finally {
      set({ isAnimating: false })
    }
  },
  undock: async () => {
    if (get().isAnimating) return
    set({ isAnimating: true })
    try {
      set(await undockWidget())
    } finally {
      set({ isAnimating: false })
    }
  }
}))
