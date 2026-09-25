import { boot, showBootFailure } from "./boot";

const root = document.getElementById("app");
if (!root) throw new Error("Missing #app root element in index.html");
boot(
  root,
  () => import("./mount"),
  (message) => showBootFailure(root, message),
);
