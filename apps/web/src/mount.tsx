import { render } from "preact";
import { App } from "./app";
import { UpdateNotice } from "./update-notice";
import "./styles.css";

export const mount = (root: HTMLElement): void =>
  render(
    <>
      <App />
      <UpdateNotice />
    </>,
    root,
  );
