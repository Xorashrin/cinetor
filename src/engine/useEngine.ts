import { useEffect } from "react";
import { AppState } from "react-native";
import * as ExpoNetwork from "expo-network";
import { EngineLifecycle } from "./lifecycle";
import {
  catalog,
  initializeEngine,
  scheduler,
  closeAdultSession,
} from "./runtime";
import { registerBackground } from "./background";
export function useEngine(
  essentialReady: boolean,
  notify: (version: number) => void,
): void {
  useEffect(() => {
    if (!essentialReady) return;
    const unsubscribe = catalog.subscribe(() => notify(catalog.version));
    notify(catalog.version);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const clear = () => {
      if (timer) clearTimeout(timer);
      timer = undefined;
    };
    const schedule = () => {
      clear();
      timer = setTimeout(
        () => lifecycle.change(true),
        Math.max(60000, scheduler.nextEligible() - Date.now()),
      );
    };
    const lifecycle = new EngineLifecycle(
      async () => {
        await initializeEngine();
        await registerBackground();
      },
      () => scheduler.run("foreground"),
      () => scheduler.cancel(),
      schedule,
      clear,
    );
    lifecycle.start();
    if (AppState.currentState !== "active") lifecycle.change(false);
    const app = AppState.addEventListener("change", (state) => {
      if (state !== "active") closeAdultSession();
      lifecycle.change(state === "active");
    });
    const net = ExpoNetwork.addNetworkStateListener((state) => {
      if (state.isConnected === false) scheduler.cancel();
      else if (AppState.currentState === "active") lifecycle.change(true);
    });
    return () => {
      lifecycle.stop();
      app.remove();
      net.remove();
      unsubscribe();
    };
  }, [essentialReady, notify]);
}
