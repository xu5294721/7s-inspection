import { useEffect, useState, type ReactNode } from "react";
import { initializeApp } from "./dependencies";
import { useAppDependencies } from "./useAppDependencies";

export function AppInitializer({ children }: { children: ReactNode }) {
  const dependencies = useAppDependencies();
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");

  useEffect(() => {
    let active = true;
    initializeApp(dependencies).then(
      () => active && setState("ready"),
      () => active && setState("failed"),
    );
    return () => {
      active = false;
    };
  }, [dependencies]);

  if (state === "failed") {
    return <p className="status-message" role="alert">项点库加载失败，请重新打开应用。</p>;
  }

  if (state === "loading") {
    return <p className="status-message" role="status">正在加载...</p>;
  }

  return children;
}
