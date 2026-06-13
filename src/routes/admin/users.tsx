import { useEffect, useState, type FormEvent } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, redirect } from "@tanstack/react-router";
import { Ban, Save, Trash2, UserPlus, UsersRound } from "lucide-react";
import { AppRail } from "@/components/AppRail";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  createUserInvite,
  deleteManagedUser,
  getSessionSnapshot,
  listManagedUsers,
  listUserInvites,
  revokeUserInvite,
  updateManagedUser,
  type InviteRole,
  type ManagedUserRole,
} from "@/lib/auth-workflow";

export const Route = createFileRoute("/admin/users")({
  loader: async () => {
    const session = await getSessionSnapshot();
    if (!session) throw redirect({ to: "/sign-in" });
    if (session.user.role !== "admin") throw redirect({ to: "/" });
    return { session };
  },
  head: () => ({
    meta: [{ title: "Users | Vertex AI Command Center" }],
  }),
  component: AdminUsersPage,
});

type ListedInvite = Awaited<ReturnType<typeof listUserInvites>>[number];
type ListedUser = Awaited<ReturnType<typeof listManagedUsers>>[number];
type ActiveTab = "users" | "invites";
type AdminConfirmDialogState = {
  title: string;
  description: string;
  actionLabel: string;
  onConfirm: () => Promise<void> | void;
} | null;

const usersQueryKey = ["admin", "users"] as const;
const invitesQueryKey = ["admin", "invites"] as const;

function AdminUsersPage() {
  const { session } = Route.useLoaderData();
  const [activeTab, setActiveTab] = useState<ActiveTab>("users");
  const [email, setEmail] = useState("rogerleecormier@gmail.com");
  const [name, setName] = useState("Roger Test User");
  const [role, setRole] = useState<InviteRole>("user");
  const [userDrafts, setUserDrafts] = useState<Record<string, Pick<ListedUser, "name" | "role">>>({});
  const [message, setMessage] = useState("");
  const [inviteLink, setInviteLink] = useState("");
  const [confirmDialog, setConfirmDialog] = useState<AdminConfirmDialogState>(null);
  const queryClient = useQueryClient();

  const usersQuery = useQuery({
    queryKey: usersQueryKey,
    queryFn: () => listManagedUsers(),
    refetchInterval: 15_000,
  });

  const invitesQuery = useQuery({
    queryKey: invitesQueryKey,
    queryFn: () => listUserInvites(),
    refetchInterval: 15_000,
  });

  const users = usersQuery.data ?? [];
  const invites = invitesQuery.data ?? [];

  useEffect(() => {
    setUserDrafts((currentDrafts) => {
      const nextDrafts: Record<string, Pick<ListedUser, "name" | "role">> = {};
      for (const user of users) {
        nextDrafts[user.id] = currentDrafts[user.id] ?? { name: user.name, role: user.role };
      }
      return nextDrafts;
    });
  }, [users]);

  const createInviteMutation = useMutation({
    mutationFn: (data: { email: string; name: string; role: InviteRole }) => createUserInvite({ data }),
    onSuccess: async (result) => {
      setMessage(result.emailResult.sent ? `Invite sent to ${result.email}.` : `Invite created, but email was not sent: ${result.emailResult.reason}`);
      setInviteLink(result.emailResult.sent ? "" : result.inviteLink);
      await queryClient.invalidateQueries({ queryKey: invitesQueryKey });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Could not create invite.");
    },
  });

  const saveUserMutation = useMutation({
    mutationFn: ({ userId, name, role }: { userId: string; name: string; role: ManagedUserRole; email: string }) => updateManagedUser({ data: { userId, name, role } }),
    onSuccess: async (_result, variables) => {
      setMessage(`Updated ${variables.email}.`);
      await queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Could not update user.");
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: (data: { userId: string; email: string }) => deleteManagedUser({ data: { userId: data.userId } }),
    onSuccess: async (_result, variables) => {
      setMessage(`Deleted ${variables.email}.`);
      await queryClient.invalidateQueries({ queryKey: usersQueryKey });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Could not delete user.");
    },
  });

  const revokeInviteMutation = useMutation({
    mutationFn: (inviteId: string) => revokeUserInvite({ data: { inviteId } }),
    onSuccess: async () => {
      setMessage("Invite revoked.");
      await queryClient.invalidateQueries({ queryKey: invitesQueryKey });
    },
    onError: (error) => {
      setMessage(error instanceof Error ? error.message : "Could not revoke invite.");
    },
  });

  function updateUserDraft(userId: string, patch: Partial<Pick<ListedUser, "name" | "role">>) {
    setUserDrafts((currentDrafts) => ({
      ...currentDrafts,
      [userId]: {
        ...currentDrafts[userId],
        ...patch,
      },
    }));
  }

  async function handleSaveUser(user: ListedUser) {
    setMessage("");
    setInviteLink("");
    const draft = userDrafts[user.id] ?? user;
    await saveUserMutation.mutateAsync({ userId: user.id, name: draft.name, role: draft.role as ManagedUserRole, email: user.email });
  }

  function handleDeleteUser(user: ListedUser) {
    setConfirmDialog({
      title: `Delete ${user.email}`,
      description: "This removes the user's sessions and sign-in account.",
      actionLabel: "Delete user",
      onConfirm: async () => {
        setMessage("");
        setInviteLink("");
        await deleteUserMutation.mutateAsync({ userId: user.id, email: user.email });
      },
    });
  }

  async function handleCreateInvite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    setInviteLink("");
    await createInviteMutation.mutateAsync({ email, name, role });
  }

  async function handleRevokeInvite(inviteId: string) {
    setMessage("");
    setInviteLink("");
    await revokeInviteMutation.mutateAsync(inviteId);
  }

  return (
    <main className="h-svh overflow-hidden bg-[linear-gradient(135deg,oklch(0.985_0.006_247),oklch(0.955_0.015_240))] p-0 text-foreground lg:p-5">
      <div className="workspace-shadow grid h-full overflow-hidden border bg-card lg:grid-cols-[72px_minmax(0,1fr)] lg:rounded-xl">
        <AppRail />
        <section className="scrollbar-thin min-h-0 overflow-auto bg-muted/30 p-4 lg:p-8">
          <div className="mx-auto grid max-w-6xl gap-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold">Users</h1>
            <p className="text-sm text-muted-foreground">Manage user accounts, roles, and account invitations for Vertex AI Command Center.</p>
          </div>
          <Button type="button" variant="outline" onClick={() => (window.location.href = "/")}>
            Back to workspace
          </Button>
        </div>

        <div className="flex w-fit rounded-md border bg-background p-1">
          <Button type="button" variant={activeTab === "users" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("users")}>
            <UsersRound className="size-4" />
            Users
          </Button>
          <Button type="button" variant={activeTab === "invites" ? "default" : "ghost"} size="sm" onClick={() => setActiveTab("invites")}>
            <UserPlus className="size-4" />
            Invites
          </Button>
        </div>

        {message ? <p className="rounded-md border bg-background p-3 text-sm text-muted-foreground">{message}</p> : null}
        {inviteLink ? (
          <a className="block break-all rounded-md border bg-background p-3 text-sm font-medium text-primary" href={inviteLink}>
            {inviteLink}
          </a>
        ) : null}

        {activeTab === "users" ? (
          <Card>
              <CardHeader>
                <CardTitle>User accounts</CardTitle>
                <CardDescription>Edit names, change roles, and remove accounts that should no longer have access.</CardDescription>
              </CardHeader>
              <CardContent>
              {usersQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading users...</p> : null}
              {usersQuery.isError ? <p className="text-sm text-destructive">Could not load users.</p> : null}
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Email</TableHead>
                    <TableHead>Name</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Verified</TableHead>
                    <TableHead>Updated</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell className="font-medium">{user.email}</TableCell>
                      <TableCell>
                        <Input value={userDrafts[user.id]?.name ?? user.name} onChange={(event) => updateUserDraft(user.id, { name: event.target.value })} />
                      </TableCell>
                      <TableCell>
                        <select
                          className="h-9 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                          value={userDrafts[user.id]?.role ?? user.role}
                          onChange={(event) => updateUserDraft(user.id, { role: event.target.value as ManagedUserRole })}
                        >
                          <option value="viewer">Viewer</option>
                          <option value="user">User</option>
                          <option value="admin">Admin</option>
                        </select>
                      </TableCell>
                      <TableCell>{user.emailVerified ? "Yes" : "No"}</TableCell>
                      <TableCell>{user.updatedLabel}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" disabled={saveUserMutation.isPending && saveUserMutation.variables?.userId === user.id} onClick={() => handleSaveUser(user)}>
                            <Save className="size-4" />
                            Save
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={user.id === session.user.id || (deleteUserMutation.isPending && deleteUserMutation.variables?.userId === user.id)}
                            onClick={() => handleDeleteUser(user)}
                          >
                            <Trash2 className="size-4" />
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        ) : (
          <div className="grid gap-5">
            <Card>
              <CardHeader>
                <div className="flex items-start gap-3">
                  <span className="grid size-10 place-items-center rounded-md bg-primary text-primary-foreground">
                    <UserPlus className="size-5" />
                  </span>
                  <div>
                    <CardTitle>Create invite</CardTitle>
                    <CardDescription>Only vertexeducation.com addresses are allowed, plus rogerleecormier@gmail.com for this test.</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <form className="grid gap-4 md:grid-cols-[1fr_1fr_140px_auto]" onSubmit={handleCreateInvite}>
                  <div className="space-y-2">
                    <Label htmlFor="invite-email">Email</Label>
                    <Input id="invite-email" value={email} onChange={(event) => setEmail(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-name">Name</Label>
                    <Input id="invite-name" value={name} onChange={(event) => setName(event.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="invite-role">Role</Label>
                    <select
                      id="invite-role"
                      className="h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
                      value={role}
                      onChange={(event) => setRole(event.target.value as InviteRole)}
                    >
                      <option value="viewer">Viewer</option>
                      <option value="user">User</option>
                      <option value="admin">Admin</option>
                    </select>
                  </div>
                  <div className="flex items-end">
                    <Button className="w-full" type="submit" disabled={createInviteMutation.isPending}>
                      Invite
                    </Button>
                  </div>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Invites</CardTitle>
                <CardDescription>Recent account invitations and first-use status.</CardDescription>
              </CardHeader>
              <CardContent>
                {invitesQuery.isLoading ? <p className="text-sm text-muted-foreground">Loading invites...</p> : null}
                {invitesQuery.isError ? <p className="text-sm text-destructive">Could not load invites.</p> : null}
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Email</TableHead>
                      <TableHead>Name</TableHead>
                      <TableHead>Role</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Expires</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {invites.map((invite) => (
                      <TableRow key={invite.id}>
                        <TableCell>{invite.email}</TableCell>
                        <TableCell>{invite.name}</TableCell>
                        <TableCell>{invite.role}</TableCell>
                        <TableCell>{invite.status}</TableCell>
                        <TableCell>{invite.expiresLabel}</TableCell>
                        <TableCell className="text-right">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={invite.status !== "Pending" || (revokeInviteMutation.isPending && revokeInviteMutation.variables === invite.id)}
                            onClick={() => handleRevokeInvite(invite.id)}
                          >
                            <Ban className="size-4" />
                            Revoke
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>
        )}
          </div>
        </section>
        <AdminConfirmDialog
          state={confirmDialog}
          onOpenChange={(open) => {
            if (!open) setConfirmDialog(null);
          }}
        />
      </div>
    </main>
  );
}

function AdminConfirmDialog({
  state,
  onOpenChange,
}: {
  state: AdminConfirmDialogState;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState("");

  async function handleConfirm() {
    if (!state) return;
    setIsPending(true);
    setError("");
    try {
      await state.onConfirm();
      onOpenChange(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : "The action could not be completed.");
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Dialog open={Boolean(state)} onOpenChange={(open) => !isPending && onOpenChange(open)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{state?.title ?? "Confirm action"}</DialogTitle>
          <DialogDescription>{state?.description ?? "Confirm this action before continuing."}</DialogDescription>
        </DialogHeader>
        {error ? <p className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={isPending} onClick={handleConfirm}>
            {isPending ? "Working..." : state?.actionLabel ?? "Confirm"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
