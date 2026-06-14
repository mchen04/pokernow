import React from "react";
import ReactDOM from "react-dom/client";
import { RouterProvider, createBrowserRouter } from "react-router-dom";
import "./index.css";
import Landing from "./pages/Landing";
import Room from "./pages/Room";
import Club from "./pages/Club";
import { PrefsProvider } from "./lib/prefs";
import { ErrorBoundary } from "./components/ErrorBoundary";

const router = createBrowserRouter([
  { path: "/", element: <Landing /> },
  { path: "/room/:roomId", element: <Room /> },
  { path: "/club/:clubId", element: <Club /> },
]);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <PrefsProvider>
        <RouterProvider router={router} />
      </PrefsProvider>
    </ErrorBoundary>
  </React.StrictMode>
);
