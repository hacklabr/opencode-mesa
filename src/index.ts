import { Plugin } from "@opencode/plugin"
import { server } from "./v1/server.js"
import { setup } from "./v2/setup.js"

const definition = Plugin.define({
  id: "mesa",
  setup,
})

/**
 * Dual-host entrypoint (OpenCode V1 + V2):
 *
 * - V2 reads `id` + `setup()` from this object.
 * - V1 (>= 1.18.29) calls `server()` and consumes the returned hook map.
 *
 * The two APIs stay separate by design; shared behavior lives in
 * `tools/registry.ts`, `workflow/`, and `tools/peer-transport.ts`.
 */
export default {
  ...definition,
  server,
}

export { server as mesa, setup, definition }
