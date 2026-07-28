import type { Locale } from "@/lib/i18n";
import type {
  BydmateLiveSnapshotRow,
  Car,
  ChargingSessionRow,
} from "@/types/database";

export type DashboardBootstrapData = {
  cars: Car[];
  liveSnapshots: BydmateLiveSnapshotRow[];
  sessions: ChargingSessionRow[];
  selectedCarId: string | null;
  locale: Locale;
};
