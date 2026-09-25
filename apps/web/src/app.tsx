import { Redirect, Route, Switch } from "wouter-preact";
import { Board } from "./board";

export const DEFAULT_BOARD = "default";

export function App() {
  return (
    <Switch>
      <Route path="/b/:boardId">
        {(params) => <Board key={params.boardId} boardId={params.boardId} />}
      </Route>
      <Route>
        <Redirect to={`/b/${DEFAULT_BOARD}`} replace />
      </Route>
    </Switch>
  );
}
