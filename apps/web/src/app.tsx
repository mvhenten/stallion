import { Redirect, useLocation } from "wouter-preact";
import { Board } from "./board";
import { boardIdFromPath } from "./board-path";
import { Landing } from "./landing";

export function App() {
  const [location] = useLocation();
  const boardId = boardIdFromPath(location);
  if (boardId !== undefined) return <Board key={boardId} boardId={boardId} />;
  if (location === "/") return <Landing />;
  return <Redirect to="/" replace />;
}
