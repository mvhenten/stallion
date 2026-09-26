import { Redirect, Route, Switch } from "wouter-preact";
import { Board } from "./board";
import { Landing } from "./landing";

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
      <Route path="/">
        <Landing />
      </Route>
      <Route>
        <Redirect to="/" replace />
      </Route>
    </Switch>
  );
}
