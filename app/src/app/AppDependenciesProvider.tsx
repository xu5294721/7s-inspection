import type { ReactNode } from "react";
import type { AppDependencies } from "./dependencies";
import { DependenciesContext } from "./dependenciesContext";

export function AppDependenciesProvider({
  dependencies,
  children,
}: {
  dependencies: AppDependencies;
  children: ReactNode;
}) {
  return (
    <DependenciesContext.Provider value={dependencies}>{children}</DependenciesContext.Provider>
  );
}
