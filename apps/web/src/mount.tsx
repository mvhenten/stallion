import { render } from "preact";
import { App } from "./app";
import "./styles.css";

export const mount = (root: HTMLElement): void => render(<App />, root);
