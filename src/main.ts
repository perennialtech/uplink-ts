import "./ui/styles.css";
import { UplinkApp } from "./ui/app";

const root = document.querySelector<HTMLElement>("#app");
if (!root) {
  throw new Error("Missing #app mount point");
}

new UplinkApp(root);
