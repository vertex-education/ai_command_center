import { createAuthClient } from "better-auth/react";
import { adminClient, inferAdditionalFields, organizationClient } from "better-auth/client/plugins";
import { vertexAccessControl, vertexAuthRoles } from "@/lib/auth-access-control";
import type { Auth } from "@/lib/auth";

export const authClient = createAuthClient({
  baseURL: typeof window === "undefined" ? undefined : window.location.origin,
  plugins: [
    inferAdditionalFields<Auth>(),
    adminClient({
      ac: vertexAccessControl,
      roles: vertexAuthRoles,
    }),
    organizationClient({
      ac: vertexAccessControl,
      roles: vertexAuthRoles,
    }),
  ],
});
