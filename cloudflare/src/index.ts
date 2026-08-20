import { DEFAULT_DEPENDENCIES, handleRequest } from "./app";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleRequest(request, env, DEFAULT_DEPENDENCIES);
  },
} satisfies ExportedHandler<Env>;
