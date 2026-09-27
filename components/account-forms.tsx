"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { createClient } from "@/lib/supabase/client";

export function NameForm({ initial }: { initial: string }) {
  const router = useRouter();
  const [name, setName] = useState(initial);
  const [busy, setBusy] = useState(false);
  const dirty = name.trim() !== initial && name.trim().length > 0;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const r = await fetch("/api/account", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ full_name: name }),
    });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) return toast.error(d.error || "Unable to save");
    toast.success("Name updated");
    router.refresh();
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <Field>
        <FieldLabel htmlFor="full-name">Full name</FieldLabel>
        <Input id="full-name" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} autoComplete="name" />
      </Field>
      <Button type="submit" className="w-fit" disabled={!dirty || busy}>
        {busy && <Spinner data-icon="inline-start" />}
        Save
      </Button>
    </form>
  );
}

export function PasswordForm() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const tooShort = password.length > 0 && password.length < 8;
  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= 8 && confirm === password;

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await createClient().auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    setPassword("");
    setConfirm("");
    toast.success("Password updated");
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3">
      <Field data-invalid={tooShort || undefined}>
        <FieldLabel htmlFor="new-password">New password</FieldLabel>
        <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        {tooShort ? <FieldError>At least 8 characters.</FieldError> : <FieldDescription>At least 8 characters.</FieldDescription>}
      </Field>
      <Field data-invalid={mismatch || undefined}>
        <FieldLabel htmlFor="confirm-password">Confirm password</FieldLabel>
        <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
        {mismatch && <FieldError>Passwords don’t match.</FieldError>}
      </Field>
      <Button type="submit" className="w-fit" disabled={!ready || busy}>
        {busy && <Spinner data-icon="inline-start" />}
        Update password
      </Button>
    </form>
  );
}
