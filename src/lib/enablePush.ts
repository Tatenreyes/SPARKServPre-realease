"use client";

function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const array = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i++) {
    array[i] = rawData.charCodeAt(i);
  }
  return array.buffer;
}

function supportsPush(): boolean {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export async function getPushNotificationState(): Promise<"on" | "off" | "denied" | "unsupported"> {
  if (!supportsPush() || !process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) return "unsupported";
  if (Notification.permission === "denied") return "denied";

  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return "off";

  const response = await fetch("/api/push-subscriptions", {
    cache: "no-store",
    headers: { "x-push-endpoint": subscription.endpoint },
  });
  if (!response.ok) throw new Error("Could not check the saved push subscription.");
  const { enabled } = await response.json();
  return enabled === true ? "on" : "off";
}

export async function enablePushNotifications(): Promise<NotificationPermission | "unsupported"> {
  const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  if (!supportsPush() || !publicKey) return "unsupported";

  const permission = await Notification.requestPermission();
  if (permission !== "granted") return permission;

  const registration = await navigator.serviceWorker.register("/sw.js");
  await navigator.serviceWorker.ready;
  const existing = await registration.pushManager.getSubscription();
  const subscription = existing ?? await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  });

  try {
    const response = await fetch("/api/push-subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(subscription.toJSON()),
    });
    if (!response.ok) throw new Error("Could not save the push subscription.");
  } catch (error) {
    if (!existing) await subscription.unsubscribe().catch(() => {});
    throw error;
  }
  return "granted";
}

export async function disablePushNotifications(): Promise<"removed" | "browser-cleanup-failed"> {
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  if (!subscription) return "removed";

  const response = await fetch("/api/push-subscriptions", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (!response.ok) throw new Error("Could not remove the saved push subscription.");

  // Once the server stops sending, an incomplete browser cleanup can be retried.
  const removed = await subscription.unsubscribe().catch(() => false);
  return removed ? "removed" : "browser-cleanup-failed";
}
