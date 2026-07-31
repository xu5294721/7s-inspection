import { useContext } from "react";
import type { AppDependencies } from "./dependencies";
import { DependenciesContext } from "./dependenciesContext";

export function useAppDependencies(): AppDependencies {
  const dependencies = useContext(DependenciesContext);
  if (!dependencies) {
    throw new Error("App dependencies are not available.");
  }
  return dependencies;
}
