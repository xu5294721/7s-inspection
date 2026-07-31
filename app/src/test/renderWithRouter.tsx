import { render } from "@testing-library/react";
import { App, type AppProps } from "../App";
import { createTestDb, type SevenSDb } from "../db/database";

interface RenderWithRouterOptions {
  initialPath?: string;
  database?: SevenSDb;
  appProps?: Omit<AppProps, "database">;
}

export function renderWithRouter({
  initialPath = "/",
  database = createTestDb(`ui-${Date.now()}-${Math.random()}`),
  appProps,
}: RenderWithRouterOptions = {}) {
  window.location.hash = `#${initialPath}`;

  return {
    database,
    ...render(<App database={database} {...appProps} />),
  };
}
