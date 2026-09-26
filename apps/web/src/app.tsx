import { Redirect, Route, Switch } from "wouter-preact";
import { Board } from "./board";

export const DEFAULT_BOARD = "default";

export const decodeBoardId = (segment: string): string => {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

export function App() {
  return (
    <Switch>
      <Route path="/b/:boardId">
        {(params) => {
          const boardId = decodeBoardId(params.boardId);
          return <Board key={boardId} boardId={boardId} />;
        }}
      </Route>
      <Route>
        <Redirect to={`/b/${DEFAULT_BOARD}`} replace />
      </Route>
    </Switch>
  );
}
