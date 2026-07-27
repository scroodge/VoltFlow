import { create } from "zustand";

import type { DerivedChargingState } from "@/features/charging/domain";

type ChargingUiState = {
  liveDerived: DerivedChargingState | null;
  setLiveDerived: (d: DerivedChargingState | null) => void;
};

/** Live derived UI snapshot (timestamp math); intentionally not persisted. */
export const useChargingUi = create<ChargingUiState>((set) => ({
  liveDerived: null,
  setLiveDerived: (liveDerived) => set({ liveDerived }),
}));
