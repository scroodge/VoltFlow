export async function notifyChargeCompleted(sessionId: string, body: string) {
  if (typeof window === "undefined" || !("Notification" in window)) return;

  if (Notification.permission === "default") {
    try {
      await Notification.requestPermission();
    } catch {
      return;
    }
  }

  if (Notification.permission !== "granted") return;

  const title = "Charge complete";
  const data = { sessionId, url: `/history/${sessionId}` };

  if ("serviceWorker" in navigator) {
    try {
      const registration = await navigator.serviceWorker.ready;
      await registration.showNotification(title, {
        body,
        tag: `charge-complete:${sessionId}`,
        data,
      });
      return;
    } catch {
      /* fallback to in-page notification */
    }
  }

  const notification = new Notification(title, {
    body,
    tag: `charge-complete:${sessionId}`,
  });
  notification.onclick = () => {
    window.focus();
    window.location.href = `/history/${sessionId}`;
  };
}
