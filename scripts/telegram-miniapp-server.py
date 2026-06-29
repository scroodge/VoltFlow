#!/usr/bin/env python3
import base64
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer


def load_env_file(path):
    if not os.path.exists(path):
        return
    with open(path, "r", encoding="utf-8") as handle:
        for raw_line in handle:
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip().strip('"').strip("'")
            if key and key not in os.environ:
                os.environ[key] = value


load_env_file(".env")
load_env_file(".env.local")

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
SUPABASE_URL = os.environ.get("NEXT_PUBLIC_SUPABASE_URL", "").rstrip("/")
ANON_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY", "")
SERVICE_ROLE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")
SITE_URL = os.environ.get("NEXT_PUBLIC_SITE_URL", "https://volt-flow-beige.vercel.app").rstrip("/")
CORS_ORIGIN = os.environ.get("TELEGRAM_CORS_ORIGIN", SITE_URL)
PORT = int(os.environ.get("TELEGRAM_API_PORT") or os.environ.get("PORT") or "8787")


if not all([BOT_TOKEN, SUPABASE_URL, ANON_KEY, SERVICE_ROLE_KEY]):
    print(
        "Missing required env: TELEGRAM_BOT_TOKEN, NEXT_PUBLIC_SUPABASE_URL, "
        "NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY",
        file=sys.stderr,
    )
    sys.exit(1)


class TelegramApiHandler(BaseHTTPRequestHandler):
    server_version = "VoltFlowTelegramApi/1.0"

    def do_OPTIONS(self):
        self.send_response(204)
        self.write_cors_headers()
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self.write_json(200, {"ok": True, "service": "telegram-miniapp"})
            return
        self.write_json(404, {"ok": False, "error": "not_found"})

    def do_POST(self):
        try:
            path = urllib.parse.urlparse(self.path).path
            if path == "/api/telegram/auth":
                self.handle_auth()
                return
            if path == "/api/telegram/link":
                self.handle_link()
                return
            if path == "/api/telegram/webhook":
                self.handle_webhook()
                return
            self.write_json(404, {"ok": False, "error": "not_found"})
        except Exception as exc:
            print(f"request failed: {exc}", file=sys.stderr)
            self.write_json(500, {"ok": False, "error": "server_error"})

    def handle_auth(self):
        body = self.read_json()
        init_data = body.get("initData") if isinstance(body, dict) else ""
        verified = verify_telegram_init_data(init_data or "")
        if not verified["ok"]:
            self.write_json(401, {"ok": False, "error": verified["error"]})
            return

        tg_user = verified["user"]
        telegram_id = tg_user["id"]
        email = f"tg_{telegram_id}@telegram.voltflow"
        username = tg_user.get("username")

        linked = supabase_select_one(
            "profiles",
            {
                "select": "id,email",
                "telegram_id": f"eq.{telegram_id}",
            },
        )

        if linked:
            user_id = linked["id"]
            user_email = linked.get("email") or email
        else:
            by_email = supabase_select_one(
                "profiles",
                {
                    "select": "id,email",
                    "email": f"eq.{email}",
                },
            )
            if by_email:
                user_id = by_email["id"]
                user_email = by_email.get("email") or email
            else:
                created = supabase_auth_admin(
                    "POST",
                    "/admin/users",
                    {
                        "email": email,
                        "email_confirm": True,
                        "user_metadata": {
                            "telegram_id": telegram_id,
                            "telegram_username": username,
                            "full_name": " ".join(
                                part
                                for part in [tg_user.get("first_name"), tg_user.get("last_name")]
                                if part
                            )
                            or None,
                        },
                    },
                )
                user_id = created.get("id")
                if not user_id:
                    self.write_json(500, {"ok": False, "error": "create_failed"})
                    return
                user_email = email

            try:
                supabase_update_profile(user_id, telegram_id, username)
            except RuntimeError as exc:
                self.write_json(500, {"ok": False, "error": "link_failed", "detail": str(exc)})
                return

        link = supabase_auth_admin(
            "POST",
            "/admin/generate_link",
            {"type": "magiclink", "email": user_email},
        )
        token_hash = (
            link.get("properties", {}).get("hashed_token")
            or link.get("hashed_token")
            or link.get("action_link", "").split("token_hash=", 1)[-1].split("&", 1)[0]
        )
        if not token_hash:
            self.write_json(500, {"ok": False, "error": "session_failed", "detail": "missing_token_hash"})
            return

        session = supabase_auth_anon(
            "POST",
            "/verify",
            {"type": "magiclink", "token_hash": urllib.parse.unquote(token_hash)},
        )
        access_token = session.get("access_token")
        refresh_token = session.get("refresh_token")
        if not access_token or not refresh_token:
            self.write_json(500, {"ok": False, "error": "verify_failed"})
            return

        self.write_json(
            200,
            {
                "ok": True,
                "access_token": access_token,
                "refresh_token": refresh_token,
                "telegram_id": telegram_id,
            },
        )

    def handle_link(self):
        auth = self.headers.get("authorization", "")
        if not auth.lower().startswith("bearer "):
            self.write_json(401, {"ok": False, "error": "not_authenticated"})
            return

        access_token = auth.split(" ", 1)[1].strip()
        user = supabase_auth_get_user(access_token)
        if not user or not user.get("id"):
            self.write_json(401, {"ok": False, "error": "not_authenticated"})
            return

        body = self.read_json()
        init_data = body.get("initData") if isinstance(body, dict) else ""
        verified = verify_telegram_init_data(init_data or "")
        if not verified["ok"]:
            self.write_json(401, {"ok": False, "error": verified["error"]})
            return

        tg_user = verified["user"]
        try:
            supabase_update_profile(user["id"], tg_user["id"], tg_user.get("username"))
        except RuntimeError:
            self.write_json(500, {"ok": False, "error": "link_failed"})
            return

        self.write_json(200, {"ok": True, "telegram_id": tg_user["id"]})

    def handle_webhook(self):
        secret = os.environ.get("TELEGRAM_WEBHOOK_SECRET")
        if secret and self.headers.get("x-telegram-bot-api-secret-token") != secret:
            self.write_json(401, {"ok": False, "error": "unauthorized"})
            return

        update = self.read_json(required=False)
        chat_id = ((update or {}).get("message") or {}).get("chat", {}).get("id")
        if not chat_id:
            self.write_json(200, {"ok": True})
            return

        text = ((update or {}).get("message") or {}).get("text", "").strip()
        if text.startswith("/start") or text.startswith("/app") or text == "":
            send_telegram_message(chat_id)

        self.write_json(200, {"ok": True})

    def read_json(self, required=True):
        size = int(self.headers.get("content-length") or "0")
        if size <= 0:
            return {}
        raw = self.rfile.read(size).decode("utf-8")
        try:
            return json.loads(raw)
        except json.JSONDecodeError:
            if required:
                raise
            return {}

    def write_json(self, status, payload):
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.write_cors_headers()
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def write_cors_headers(self):
        self.send_header("access-control-allow-origin", CORS_ORIGIN)
        self.send_header("access-control-allow-credentials", "true")
        self.send_header("vary", "Origin")
        self.send_header("access-control-allow-methods", "GET,POST,OPTIONS")
        self.send_header(
            "access-control-allow-headers",
            "content-type,authorization,x-telegram-bot-api-secret-token",
        )

    def log_message(self, fmt, *args):
        print(f"{self.address_string()} - {fmt % args}")


def verify_telegram_init_data(init_data, max_age_seconds=86400):
    if not init_data:
        return {"ok": False, "error": "missing_init_data"}

    pairs = urllib.parse.parse_qsl(init_data, keep_blank_values=True)
    values = dict(pairs)
    received_hash = values.get("hash", "")
    auth_date_raw = values.get("auth_date", "")
    user_raw = values.get("user", "")

    if not received_hash:
        return {"ok": False, "error": "missing_hash"}
    if not auth_date_raw:
        return {"ok": False, "error": "missing_auth_date"}
    if not user_raw:
        return {"ok": False, "error": "missing_user"}

    check_pairs = sorted((key, value) for key, value in pairs if key != "hash")
    data_check_string = "\n".join(f"{key}={value}" for key, value in check_pairs)
    secret = hmac.new(b"WebAppData", BOT_TOKEN.encode("utf-8"), hashlib.sha256).digest()
    expected_hash = hmac.new(secret, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(received_hash, expected_hash):
        return {"ok": False, "error": "bad_hash"}

    try:
        auth_date = int(auth_date_raw)
    except ValueError:
        return {"ok": False, "error": "bad_auth_date"}
    if int(time.time()) - auth_date > max_age_seconds:
        return {"ok": False, "error": "expired"}

    try:
        user = json.loads(user_raw)
    except json.JSONDecodeError:
        return {"ok": False, "error": "bad_user"}
    if not isinstance(user.get("id"), int):
        return {"ok": False, "error": "bad_user"}

    return {"ok": True, "user": user}


def supabase_select_one(table, params):
    path = f"/rest/v1/{table}?{urllib.parse.urlencode(params)}"
    data = supabase_request("GET", path, key=SERVICE_ROLE_KEY)
    if not isinstance(data, list) or not data:
        return None
    return data[0]


def supabase_update_profile(user_id, telegram_id, username):
    params = urllib.parse.urlencode({"id": f"eq.{user_id}"})
    supabase_request(
        "PATCH",
        f"/rest/v1/profiles?{params}",
        {
            "telegram_id": telegram_id,
            "telegram_username": username,
        },
        key=SERVICE_ROLE_KEY,
        headers={"prefer": "return=minimal"},
        expect_empty=True,
    )


def supabase_auth_admin(method, path, payload=None):
    return supabase_request(method, f"/auth/v1{path}", payload, key=SERVICE_ROLE_KEY)


def supabase_auth_anon(method, path, payload=None):
    return supabase_request(method, f"/auth/v1{path}", payload, key=ANON_KEY)


def supabase_auth_get_user(access_token):
    try:
        return supabase_request(
            "GET",
            "/auth/v1/user",
            key=ANON_KEY,
            headers={"authorization": f"Bearer {access_token}"},
        )
    except RuntimeError:
        return None


def supabase_request(method, path, payload=None, key="", headers=None, expect_empty=False):
    body = None
    request_headers = {
        "apikey": key,
        "authorization": f"Bearer {key}",
        "content-type": "application/json",
        "accept": "application/json",
    }
    if headers:
        request_headers.update(headers)
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")

    request = urllib.request.Request(
        f"{SUPABASE_URL}{path}",
        data=body,
        method=method,
        headers=request_headers,
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            raw = response.read().decode("utf-8")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"supabase_http_{exc.code}:{detail[:300]}") from exc

    if expect_empty or not raw:
        return None
    return json.loads(raw)


def send_telegram_message(chat_id):
    web_app_url = os.environ.get("TELEGRAM_WEB_APP_URL") or f"{SITE_URL}/telegram"
    telegram_request(
        "sendMessage",
        {
            "chat_id": chat_id,
            "text": "VoltFlow готов. Откройте приложение, чтобы смотреть зарядку, поездки и сервис BYD.",
            "reply_markup": {
                "inline_keyboard": [[{"text": "Открыть VoltFlow", "web_app": {"url": web_app_url}}]]
            },
            "disable_web_page_preview": True,
        },
    )


def telegram_request(method, payload):
    request = urllib.request.Request(
        f"https://api.telegram.org/bot{BOT_TOKEN}/{method}",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json"},
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception as exc:
        print(f"telegram {method} failed: {exc}", file=sys.stderr)
        return None


def main():
    server = ThreadingHTTPServer(("127.0.0.1", PORT), TelegramApiHandler)
    print(f"Telegram Mini App API listening on 127.0.0.1:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
