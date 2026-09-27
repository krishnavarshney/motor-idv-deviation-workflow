"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { CloudDownload, Search } from "lucide-react";
import { notify } from "@/lib/notify";
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { visibleNav } from "@/components/nav";
import { can, type Role } from "@/lib/authz";

export function CommandMenu({ role }: { role: Role | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const go = (href: string) => {
    setOpen(false);
    setQuery("");
    router.push(href);
  };

  const fetchNow = async () => {
    setOpen(false);
    const r = await fetch("/api/jobs", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "fetch" }) });
    const d = await r.json().catch(() => ({}));
    if (r.ok) notify.success("Fetch from CoreHub queued");
    else notify.error(d.error || "Unable to queue fetch");
    router.refresh();
  };

  return (
    <>
      <Button
        variant="outline"
        className="h-9 min-w-0 flex-1 shrink justify-start gap-2 bg-muted/40 px-3 font-normal text-muted-foreground md:max-w-sm"
        onClick={() => setOpen(true)}
      >
        <Search data-icon="inline-start" />
        <span className="truncate">Search cases, registrations, pages…</span>
        <Kbd className="ml-auto hidden sm:inline-flex">⌘K</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Command menu" description="Search cases or jump to a page">
        <Command>
          <CommandInput placeholder="Case ID, registration, make or model…" value={query} onValueChange={setQuery} />
          <CommandList>
            <CommandEmpty>No matching pages.</CommandEmpty>
            {query.trim() && (
              <CommandGroup heading="Search">
                <CommandItem value={`search ${query}`} onSelect={() => go(`/referrals?q=${encodeURIComponent(query.trim())}`)}>
                  <Search />
                  Search referrals for “{query.trim()}”
                </CommandItem>
              </CommandGroup>
            )}
            {can(role, "run_jobs") && (
              <CommandGroup heading="Actions">
                <CommandItem value="fetch now corehub" onSelect={fetchNow}>
                  <CloudDownload />
                  Fetch from CoreHub now
                </CommandItem>
              </CommandGroup>
            )}
            {visibleNav(role).map((group, i) => (
              <div key={group.label}>
                {(i > 0 || query.trim()) && <CommandSeparator />}
                <CommandGroup heading={group.label}>
                  {group.items.map((item) => (
                    <CommandItem key={item.href} value={item.title} onSelect={() => go(item.href)}>
                      <item.icon />
                      {item.title}
                    </CommandItem>
                  ))}
                </CommandGroup>
              </div>
            ))}
          </CommandList>
        </Command>
      </CommandDialog>
    </>
  );
}
