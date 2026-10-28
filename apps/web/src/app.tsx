import { Redirect, useLocation } from "wouter-preact";
import { Board } from "./board";
import { boardIdFromPath } from "./board-path";
import { Landing } from "./landing";
import { returnPath } from "./sign-in";

export function App() {
  const [location] = useLocation();
  const boardId = boardIdFromPath(location);
  if (boardId !== undefined) return <Board key={boardId} boardId={boardId} />;
  if (location === "/") return <Landing />;
  if (location === "/sign-in") {
    return <Redirect to={returnPath(window.location.search, window.location.origin)} replace />;
  }
  return <Redirect to="/" replace />;
}
