import { createMiddleware } from "@tanstack/react-start";
import { createDbContext, type DbContext } from "@/db";

type MiddlewareContext = {
  cloudflare?: {
    env?: Partial<Env>;
  };
};

export const dbMiddleware = createMiddleware({ type: "function" }).server(async ({ context, next }) => {
  return next({
    context: {
      dbContext: createDbContext(context as unknown as MiddlewareContext),
    },
  });
});

export type DbMiddlewareContext = {
  dbContext: DbContext;
};
