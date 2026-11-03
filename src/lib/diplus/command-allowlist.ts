export const DIPLUS_DENY_PATTERNS = [
  "发送CAN",
  "执行SHELL",
  "执行TSHELL",
  "点击",
  "滑动",
  "按钮",
  "按键",
  "浮窗",
  "下电",
] as const;

/**
 * Commands confirmed on the actual car. Keep this in sync with Mate's
 * CommandAllowlist: other historical cloud types must never reach DiPlus.
 */
export const VEHICLE_COMMAND_TYPES = [
  "window",
  "windows_preset",
  "ac",
  "ac_temp_step",
  "fan_speed_step",
  "ac_recirculation",
  "seat_heat_driver",
] as const;

export type VehicleCommandType = (typeof VEHICLE_COMMAND_TYPES)[number];
export type VehicleCommandParams = Record<string, unknown>;

/**
 * This is not a di+ phrase. Mate captures the local `pano` stream and uploads one
 * private JPEG, so it must be routed before buildDiplusPhrase().
 */
export const CAMERA_SNAPSHOT_COMMAND_TYPE = "camera_snapshot";

const WINDOW_TARGETS: Record<string, string> = {
  driver: "主驾车窗",
  pass: "副驾车窗",
  rl: "左后车窗",
  rr: "右后车窗",
  all: "全部车窗",
};

const WINDOWS_PRESET_PHRASES: Record<string, string> = {
  vent: "车窗通风",
  close: "车窗关闭",
  open: "车窗全开",
  half: "车窗半开",
};

export type AllowlistResult =
  | { ok: true; phrase: string }
  | { ok: false; error: string };

function containsDeniedPhrase(text: string) {
  return DIPLUS_DENY_PATTERNS.some((pattern) => text.includes(pattern));
}

function readInt(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.trunc(parsed);
  }
  return null;
}

function readBool(value: unknown) {
  if (typeof value === "boolean") return value;
  if (value === "true" || value === 1 || value === "1") return true;
  if (value === "false" || value === 0 || value === "0") return false;
  return null;
}

export function buildDiplusPhrase(
  type: string,
  params: VehicleCommandParams,
): AllowlistResult {
  let phrase: string;

  switch (type) {
    case "window": {
      const target = WINDOW_TARGETS[typeof params.which === "string" ? params.which : ""];
      const pct = readInt(params.pct);
      if (!target) return { ok: false, error: "window.which invalid" };
      if (pct == null || pct < 0 || pct > 100) {
        return { ok: false, error: "window.pct must be 0–100" };
      }
      phrase = `${target}打开百分之${pct}`;
      break;
    }
    case "windows_preset": {
      const preset = WINDOWS_PRESET_PHRASES[
        typeof params.preset === "string" ? params.preset : ""
      ];
      if (!preset) return { ok: false, error: "windows_preset.preset invalid" };
      phrase = preset;
      break;
    }
    case "ac": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "ac.on must be boolean" };
      phrase = on ? "自动空调" : "关空调";
      break;
    }
    case "ac_temp_step": {
      const direction = typeof params.direction === "string" ? params.direction : "";
      if (direction !== "up" && direction !== "down") {
        return { ok: false, error: "ac_temp_step.direction must be up or down" };
      }
      phrase = direction === "up" ? "空调升温" : "空调降温";
      break;
    }
    case "fan_speed_step": {
      const direction = typeof params.direction === "string" ? params.direction : "";
      if (direction !== "up" && direction !== "down") {
        return { ok: false, error: "fan_speed_step.direction must be up or down" };
      }
      phrase = direction === "up" ? "升风速" : "降风速";
      break;
    }
    case "ac_recirculation": {
      const mode = typeof params.mode === "string" ? params.mode : "";
      if (mode !== "internal" && mode !== "external") {
        return { ok: false, error: "ac_recirculation.mode must be internal or external" };
      }
      phrase = mode === "internal" ? "内循环" : "外循环";
      break;
    }
    case "seat_heat_driver": {
      const level = readInt(params.level);
      if (level !== 0 && level !== 2) {
        return { ok: false, error: "seat_heat_driver.level must be 0 or 2" };
      }
      phrase = level === 2 ? "主驾座椅加热2档" : "关闭主驾座椅加热";
      break;
    }
    default:
      return { ok: false, error: `Unknown command type: ${type}` };
  }

  if (containsDeniedPhrase(phrase)) {
    return { ok: false, error: "Built phrase matches deny-list" };
  }
  return { ok: true, phrase };
}

export function validateVehicleCommand(type: string, params: VehicleCommandParams) {
  if (type === CAMERA_SNAPSHOT_COMMAND_TYPE) {
    return Object.keys(params ?? {}).length === 0
      ? ({ ok: true, phrase: "" } satisfies AllowlistResult)
      : ({ ok: false, error: "camera_snapshot does not accept parameters" } satisfies AllowlistResult);
  }
  return buildDiplusPhrase(type, params ?? {});
}
