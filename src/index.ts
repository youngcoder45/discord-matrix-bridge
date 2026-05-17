import "dotenv/config";
import { loadConfig } from "./config.js";
import { StateStore } from "./state.js";
import { startBridge } from "./startBridge.js";

async function main() {
  const config = await loadConfig();
  const state = new StateStore(config.bridge.statePath);
  await state.load();

  await startBridge(config, state);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exitCode = 1;
});
