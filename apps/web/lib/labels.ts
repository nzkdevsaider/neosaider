import type { InstallState, ModuleNetwork } from "@neosaider/contracts";

export const NETWORK_LABELS: Record<ModuleNetwork, string> = {
  isolated:
    "Red aislada: solo el harness puede hablar con el módulo; no sale a internet.",
  outbound:
    "Red saliente: puede conectarse a internet y a dispositivos de tu red local.",
};

export const STATE_LABELS: Record<InstallState, string> = {
  installing: "Instalando",
  running: "En marcha",
  stopped: "Parado",
  failed: "Error",
  removing: "Desinstalando",
};
