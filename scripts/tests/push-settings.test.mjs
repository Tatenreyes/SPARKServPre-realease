import assert from "node:assert/strict";
import test from "node:test";
import {
  disablePushNotifications,
  enablePushNotifications,
  getPushNotificationState,
} from "../../src/lib/enablePush.ts";

test("push settings report the result of browser and server changes", async (t) => {
  const savedKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
  process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = "AA";
  t.after(() => {
    if (savedKey === undefined) delete process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    else process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY = savedKey;
  });

  let existing = false;
  let unsubscribeResult = true;
  const unsubscribe = t.mock.fn(async () => unsubscribeResult);
  const subscription = {
    endpoint: "https://push.example.test/demo",
    toJSON: () => ({ endpoint: subscription.endpoint, keys: { auth: "mock", p256dh: "mock" } }),
    unsubscribe,
  };
  const registration = {
    pushManager: {
      getSubscription: async () => existing ? subscription : null,
      subscribe: async () => subscription,
    },
  };
  const methods = {
    window: { PushManager: {}, Notification: {}, atob: globalThis.atob },
    navigator: { serviceWorker: {
      getRegistration: async () => registration,
      register: async () => registration,
      ready: Promise.resolve(registration),
    } },
    Notification: { permission: "granted", requestPermission: async () => "granted" },
  };
  for (const [key, value] of Object.entries(methods)) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, value });
    t.after(() => {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    });
  }

  let response = { ok: false };
  const fetchMock = t.mock.method(globalThis, "fetch", async () => response);

  await assert.rejects(enablePushNotifications(), /Could not save/);
  assert.equal(unsubscribe.mock.callCount(), 1, "undo a just-created browser subscription after a failed save");
  response = { ok: true };
  assert.equal(await enablePushNotifications(), "granted");

  existing = true;
  response = { ok: true, json: async () => ({ enabled: false }) };
  assert.equal(await getPushNotificationState(), "off", "a local subscription alone cannot make the switch read on");
  response = { ok: true, json: async () => ({ enabled: true }) };
  assert.equal(await getPushNotificationState(), "on");

  response = { ok: false };
  await assert.rejects(disablePushNotifications(), /Could not remove/);
  assert.equal(unsubscribe.mock.callCount(), 1, "keep the browser subscription available for a retry");
  assert.equal(fetchMock.mock.calls.at(-1).arguments[1].method, "DELETE");

  response = { ok: true };
  unsubscribeResult = false;
  assert.equal(await disablePushNotifications(), "browser-cleanup-failed");
  unsubscribeResult = true;
  assert.equal(await disablePushNotifications(), "removed");
});
