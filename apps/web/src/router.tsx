import { createRootRoute, createRoute, createRouter, Outlet } from "@tanstack/react-router";
import { GamePage } from "./routes/game-page";
import { HomePage } from "./routes/home-page";

const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
});

const gameRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/games/$gameId",
  component: GamePage,
});

const routeTree = rootRoute.addChildren([indexRoute, gameRoute]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
