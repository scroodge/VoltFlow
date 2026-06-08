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

export const VEHICLE_COMMAND_TYPES = [
  "lock",
  "unlock",
  "set_soc_limit",
  "schedule_charge",
  "window",
  "sunroof",
  "sunshade",
  "hud",
  "auto_highbeam",
  "child_lock_left",
  "tts",
] as const;

export type VehicleCommandType = (typeof VEHICLE_COMMAND_TYPES)[number];

export type VehicleCommandParams = Record<string, unknown>;

const WINDOW_TARGETS: Record<string, string> = {
  driver: "主驾车窗",
  pass: "副驾车窗",
  rl: "左后车窗",
  rr: "右后车窗",
  all: "全部车窗",
};

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

export type AllowlistResult =
  | { ok: true; phrase: string }
  | { ok: false; error: string };

export function buildDiplusPhrase(
  type: string,
  params: VehicleCommandParams,
): AllowlistResult {
  if (!VEHICLE_COMMAND_TYPES.includes(type as VehicleCommandType)) {
    return { ok: false, error: `Unknown command type: ${type}` };
  }

  let phrase: string;

  switch (type) {
    case "lock":
      phrase = "车门上锁";
      break;
    case "unlock":
      phrase = "车门解锁";
      break;
    case "set_soc_limit": {
      const value = readInt(params.value);
      if (value == null || value < 50 || value > 100) {
        return { ok: false, error: "set_soc_limit.value must be 50–100" };
      }
      phrase = `设置SOC${value}`;
      break;
    }
    case "schedule_charge": {
      const hh = readInt(params.hh);
      const mm = readInt(params.mm);
      const end = readInt(params.end);
      if (hh == null || hh < 0 || hh > 23) return { ok: false, error: "schedule_charge.hh invalid" };
      if (mm == null || mm < 0 || mm > 59) return { ok: false, error: "schedule_charge.mm invalid" };
      if (end == null || end < 0 || end > 23) return { ok: false, error: "schedule_charge.end invalid" };
      phrase = `预约充电${hh}:${String(mm).padStart(2, "0")}-${end}`;
      break;
    }
    case "window": {
      const which = typeof params.which === "string" ? params.which : "";
      const cn = WINDOW_TARGETS[which];
      if (!cn) return { ok: false, error: "window.which invalid" };
      const pct = readInt(params.pct);
      if (pct == null || pct < 0 || pct > 100) return { ok: false, error: "window.pct must be 0–100" };
      phrase = `${cn}打开百分之${pct}`;
      break;
    }
    case "sunroof": {
      const pct = readInt(params.pct);
      if (pct == null || pct < 0 || pct > 100) return { ok: false, error: "sunroof.pct must be 0–100" };
      phrase = `天窗打开百分之${pct}`;
      break;
    }
    case "sunshade": {
      const pct = readInt(params.pct);
      if (pct == null || pct < 0 || pct > 100) return { ok: false, error: "sunshade.pct must be 0–100" };
      phrase = `遮阳帘打开百分之${pct}`;
      break;
    }
    case "hud": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "hud.on must be boolean" };
      phrase = on ? "打开HUD" : "关闭HUD";
      break;
    }
    case "auto_highbeam": {
      const on = readBool(params.on);
      if (on == null) return { ok: false, error: "auto_highbeam.on must be boolean" };
      phrase = on ? "打开自动远光" : "关闭自动远光";
      break;
    }
    case "child_lock_left":
      phrase = "打开左童锁";
      break;
    case "tts": {
      const text = typeof params.text === "string" ? params.text.trim() : "";
      if (!text || text.length > 80) return { ok: false, error: "tts.text must be 1–80 chars" };
      if (/[[\]]/.test(text)) return { ok: false, error: "tts.text must not contain brackets" };
      phrase = `播报${text}`;
      break;
    }
    default:
      return { ok: false, error: "Unsupported command type" };
  }

  if (containsDeniedPhrase(phrase)) {
    return { ok: false, error: "Built phrase matches deny-list" };
  }

  return { ok: true, phrase };
}

export function validateVehicleCommand(type: string, params: VehicleCommandParams) {
  return buildDiplusPhrase(type, params ?? {});
}
