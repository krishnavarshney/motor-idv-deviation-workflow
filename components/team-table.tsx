"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { UserPlus } from "lucide-react";
import { notify } from "@/lib/notify";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { ROLES, type Role } from "@/lib/authz";
import { dateTime } from "@/lib/format";

export type Member = { id: string; name: string | null; email: string; role: Role; is_active: boolean; last_sign_in_at: string | null };

async function send(url: string, method: string, body: unknown) {
  const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || "Request failed");
  return d;
}

export function InviteDialog() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("operator");
  const [busy, setBusy] = useState(false);

  async function invite() {
    setBusy(true);
    try {
      const d = await send("/api/admin/team", "POST", { email, role });
      if (d.warning) notify.warning(d.warning);
      else notify.success(`Invitation sent to ${email}`);
      setOpen(false);
      setEmail("");
      router.refresh();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Unable to invite");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <UserPlus data-icon="inline-start" />
          Invite
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Invite a teammate</DialogTitle>
          <DialogDescription>They get an email link to set a password.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <Field>
            <FieldLabel htmlFor="invite-email">Email</FieldLabel>
            <Input id="invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
          </Field>
          <Field>
            <FieldLabel>Role</FieldLabel>
            <Select value={role} onValueChange={(v) => setRole(v as Role)}>
              <SelectTrigger className="capitalize">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => (
                  <SelectItem key={r} value={r} className="capitalize">
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button disabled={busy || !email.includes("@")} onClick={invite}>
            {busy && <Spinner data-icon="inline-start" />}
            Send invite
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function TeamTable({ members, currentUserId }: { members: Member[]; currentUserId: string }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function update(id: string, patch: Partial<Pick<Member, "role" | "is_active">>, success: string) {
    setBusyId(id);
    try {
      await send(`/api/admin/team/${id}`, "PATCH", patch);
      notify.success(success);
      router.refresh();
    } catch (err) {
      notify.error(err instanceof Error ? err.message : "Unable to update");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="pl-4">Member</TableHead>
          <TableHead>Role</TableHead>
          <TableHead>Active</TableHead>
          <TableHead className="hidden pr-4 md:table-cell">Last sign-in</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {members.map((m) => {
          const self = m.id === currentUserId;
          return (
            <TableRow key={m.id}>
              <TableCell className="pl-4">
                <div className="font-medium">
                  {m.name || m.email}
                  {self && <span className="ml-2 text-xs text-muted-foreground">(you)</span>}
                </div>
                {m.name && <div className="text-xs text-muted-foreground">{m.email}</div>}
              </TableCell>
              <TableCell>
                <Select
                  value={m.role}
                  disabled={self || busyId === m.id}
                  onValueChange={(v) => update(m.id, { role: v as Role }, `${m.name || m.email} is now ${v}`)}
                >
                  <SelectTrigger className="w-36 capitalize" aria-label={`Role for ${m.email}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r} className="capitalize">
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </TableCell>
              <TableCell>
                <Switch
                  checked={m.is_active}
                  disabled={self || busyId === m.id}
                  onCheckedChange={(v) => update(m.id, { is_active: v }, v ? "Access restored" : "Access removed")}
                  aria-label={`${m.is_active ? "Deactivate" : "Activate"} ${m.email}`}
                />
              </TableCell>
              <TableCell className="hidden pr-4 text-muted-foreground md:table-cell">{dateTime(m.last_sign_in_at)}</TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}
