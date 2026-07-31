import { useMemo } from "react";
import { HashRouter } from "react-router-dom";
import { AppInitializer } from "./app/AppInitializer";
import { AppShell } from "./app/AppShell";
import { AppDependenciesProvider } from "./app/AppDependenciesProvider";
import {
  createAppDependencies,
  type AppDependencies,
} from "./app/dependencies";
import { AppRouter } from "./app/router";
import { SevenSDb } from "./db/database";
import "./styles/global.css";

const defaultDatabase = new SevenSDb();

export interface AppProps {
  database?: SevenSDb;
  dependencies?: AppDependencies;
}

export function App({ database, dependencies: injectedDependencies }: AppProps = {}) {
  const dependencies = useMemo(
    () => injectedDependencies ?? createAppDependencies(database ?? defaultDatabase),
    [database, injectedDependencies],
  );

  return (
    <AppDependenciesProvider dependencies={dependencies}>
      <HashRouter>
        <AppShell>
          <AppInitializer>
            <AppRouter />
          </AppInitializer>
        </AppShell>
      </HashRouter>
    </AppDependenciesProvider>
  );
}

export default App;
