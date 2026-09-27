"use client";

import { FormEvent, useState } from "react";
import { AlertCircle, ClipboardCheck, FileClock, Gauge, Globe, ScanSearch, ShieldCheck, UserCheck } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { ThemeToggle } from "@/components/theme-toggle";
import { AnimatedLink } from "@/components/ruixen/animated-link";
import { ParticleTextDots } from "@/components/ruixen/particle-text-dots";

const PIPELINE = [
  { icon: ScanSearch, title: "CoreHub intake", body: "A sandboxed worker discovers new referrals and extracts make, model, variant, fuel, CC and requested IDV." },
  { icon: Globe, title: "OBV valuation", body: "OrangeBookValue is queried for the vehicle across Good, Very Good and Excellent condition bands." },
  { icon: Gauge, title: "Deterministic rules", body: "Requested IDV is compared against condition bands, then ₹ and % tolerances, with a reason code for every outcome." },
  { icon: UserCheck, title: "Human review", body: "Anything uncertain — low vehicle confidence, provider errors, out-of-band deviations — fails closed to an underwriter." },
  { icon: FileClock, title: "Audit trail", body: "Every check, comparison, decision and error is appended to an immutable audit log with its evidence." },
];

const SAFETY = [
  "No valuation is guessed when OrangeBookValue can't provide a reliable result.",
  "No approval when vehicle identity is below the confidence threshold.",
  "Site errors, CAPTCHA, timeouts and ambiguous results route to manual review.",
  "Dry-run is the default; credentials never leave the worker sandbox.",
];

export default function Login() {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError("");
    const { error } = await createClient().auth.signInWithPassword({ email: String(f.get("email")), password: String(f.get("password")) });
    if (error) {
      setError(error.message);
      setBusy(false);
    } else window.location.href = "/";
  }

  return (
    <div className="min-h-svh bg-background [background-image:radial-gradient(60rem_30rem_at_70%_-10rem,var(--glow),transparent_70%)]">
      <header className="sticky top-0 z-20 border-b bg-background/70 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4">
          <a href="#signin" className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <ShieldCheck className="size-4" />
            </span>
            IDV Control Center
          </a>
          <nav className="ml-auto hidden items-center gap-6 text-sm sm:flex" aria-label="Page sections">
            <AnimatedLink href="#how" showArrow={false} className="text-muted-foreground hover:text-foreground">
              How it works
            </AnimatedLink>
            <AnimatedLink href="#safety" showArrow={false} className="text-muted-foreground hover:text-foreground">
              Safety
            </AnimatedLink>
            <AnimatedLink href="#signin">Sign in</AnimatedLink>
          </nav>
          <div className="ml-auto sm:ml-0">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main>
        <section id="signin" className="mx-auto grid max-w-6xl scroll-mt-14 items-center gap-10 px-4 py-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:py-20">
          <div className="flex flex-col gap-8 duration-700 animate-in fade-in slide-in-from-bottom-3">
            <div className="flex flex-col gap-4">
              <span className="w-fit rounded-full border px-3 py-1 text-xs text-muted-foreground">Motor underwriting · IDV deviation workflow</span>
              <h1 className="text-4xl font-semibold tracking-tight text-balance sm:text-5xl">Every IDV deviation, decided with evidence.</h1>
              <p className="max-w-md text-muted-foreground text-pretty">
                Referrals flow from CoreHub through live OrangeBookValue checks and deterministic rules. Underwriters handle only the exceptions.
              </p>
            </div>

            <Card className="max-w-md">
              <CardHeader>
                <CardTitle>Operations sign in</CardTitle>
                <CardDescription>Authorised personnel only. All actions are audited.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submit}>
                  <FieldGroup>
                    {error && (
                      <Alert variant="destructive" className="duration-200 animate-in fade-in slide-in-from-top-1">
                        <AlertCircle />
                        <AlertDescription>{error}</AlertDescription>
                      </Alert>
                    )}
                    <Field>
                      <FieldLabel htmlFor="email">Email</FieldLabel>
                      <Input id="email" name="email" type="email" autoComplete="email" required autoFocus />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="password">Password</FieldLabel>
                      <Input id="password" name="password" type="password" autoComplete="current-password" required />
                    </Field>
                    <Button type="submit" disabled={busy} className="w-full">
                      {busy && <Spinner data-icon="inline-start" />}
                      {busy ? "Signing in…" : "Sign in"}
                    </Button>
                  </FieldGroup>
                </form>
              </CardContent>
            </Card>
          </div>

          <div className="relative delay-150 duration-1000 animate-in fade-in fill-mode-backwards" aria-hidden="true">
            <ParticleTextDots text="IDV" className="min-h-[200px] cursor-crosshair sm:min-h-[320px] lg:min-h-[480px]" />
            <p className="pointer-events-none absolute inset-x-0 bottom-2 hidden text-center text-xs text-muted-foreground lg:block">Move your cursor through the letters</p>
          </div>
        </section>

        <section id="how" className="scroll-mt-14 border-t">
          <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 py-16">
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">How it works</h2>
              <p className="max-w-2xl text-muted-foreground">
                An assistive pipeline, not an autonomous underwriter. Automation recommends; an authorised underwriter owns the final action.
              </p>
            </div>
            <ol className="grid gap-px overflow-hidden rounded-xl border bg-border sm:grid-cols-2 lg:grid-cols-5">
              {PIPELINE.map((s, i) => (
                <li key={s.title} className="group flex flex-col gap-3 bg-card p-5 transition-colors hover:bg-muted/60">
                  <div className="flex items-center justify-between">
                    <s.icon className="size-5 text-muted-foreground transition-colors group-hover:text-foreground" />
                    <span className="font-mono text-xs text-muted-foreground">0{i + 1}</span>
                  </div>
                  <div className="font-medium">{s.title}</div>
                  <p className="text-sm text-muted-foreground">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="safety" className="scroll-mt-14 border-t">
          <div className="mx-auto grid max-w-6xl gap-8 px-4 py-16 lg:grid-cols-[1fr_1.4fr]">
            <div className="flex flex-col gap-2">
              <h2 className="text-2xl font-semibold tracking-tight">Fail closed by design</h2>
              <p className="text-muted-foreground">When the evidence isn&apos;t clear, a person decides.</p>
            </div>
            <ul className="grid gap-3 sm:grid-cols-2">
              {SAFETY.map((t) => (
                <li key={t} className="flex gap-3 rounded-xl border p-4 text-sm">
                  <ClipboardCheck className="mt-0.5 size-4 shrink-0 text-success" />
                  {t}
                </li>
              ))}
            </ul>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted-foreground">
          <span>IDV Control Center · internal underwriting operations</span>
          <AnimatedLink href="#signin" variant="center" className="text-muted-foreground hover:text-foreground">
            Back to sign in
          </AnimatedLink>
        </div>
      </footer>
    </div>
  );
}
