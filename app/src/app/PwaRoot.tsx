import { useRegisterSW } from "virtual:pwa-register/react";
import App from "../App";
import { PwaUpdatePrompt } from "./PwaUpdatePrompt";

export function PwaRoot() {
  const {
    needRefresh: [needRefresh],
    updateServiceWorker,
  } = useRegisterSW();

  return (
    <>
      <App />
      <PwaUpdatePrompt
        needRefresh={needRefresh}
        updateServiceWorker={updateServiceWorker}
      />
    </>
  );
}
