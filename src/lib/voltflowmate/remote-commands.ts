export const REMOTE_COMMANDS_ENABLED =
  process.env.REMOTE_COMMANDS_ENABLED === "true";

export const REMOTE_COMMANDS_DISABLED = !REMOTE_COMMANDS_ENABLED;

export const ACTIVE_COMMAND_POLL_AFTER_SECONDS = 6;
export const IDLE_COMMAND_POLL_AFTER_SECONDS = 90;
export const SUSPENDED_COMMAND_POLL_AFTER_SECONDS = 300;


/**
 * Mate sends `X-Command-Standby: 1` from the app process while its shell-uid daemon is polling
 * commands on the same car. Such a poll still gets every config field (live-fast grant, battery
 * capacity, doorbell…) but claims no command, so the daemon — which survives power-off and
 * writes to the car directly — is the only executor. Older Mate builds never send it.
 */
export function isCommandStandby(request: Request): boolean {
  return request.headers.get("x-command-standby") === "1";
}
