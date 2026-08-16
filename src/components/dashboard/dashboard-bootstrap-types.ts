import type { Locale } from "@/lib/i18n";
import type {
  VoltflowMateLiveSnapshotRow,
  Car,
  ChargingSessionRow,
} from "@/types/database";

export type DashboardBootstrapData = {
  cars: Car[];
  liveSnapshots: VoltflowMateLiveSnapshotRow[];
  sessions: ChargingSessionRow[];
  selectedCarId: string | null;
  locale: Locale;
};
