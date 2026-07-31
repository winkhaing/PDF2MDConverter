import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ConverterApp } from "./src/components/ConverterApp";
import "./app/globals.css";

const root = document.getElementById("root");
if (!root) throw new Error("Desktop application root was not found.");

createRoot(root).render(
  <StrictMode>
    <ConverterApp />
  </StrictMode>,
);
