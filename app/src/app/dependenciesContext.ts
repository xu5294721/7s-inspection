import { createContext } from "react";
import type { AppDependencies } from "./dependencies";

export const DependenciesContext = createContext<AppDependencies | null>(null);
