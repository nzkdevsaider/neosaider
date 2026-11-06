import { defineModule } from "@neosaider/module-sdk";
import { z } from "zod";

export const templateModule = defineModule({
  root: new URL("..", import.meta.url),
  create({ config }) {
    return {
      register(server) {
        server.registerTool(
          "hello",
          {
            title: "Say hello",
            description: "Greet someone by name.",
            inputSchema: z.object({ name: z.string().min(1) }),
          },
          async ({ name }) => ({
            content: [{ type: "text", text: `${config.GREETING}, ${name}!` }],
          }),
        );
      },
    };
  },
});
