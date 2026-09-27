"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Search } from "lucide-react";
import {
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
import { NAV } from "@/components/nav";

export function CommandMenu() {
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

  return (
    <>
      <Button
        variant="outline"
        className="h-9 w-full max-w-sm justify-start gap-2 bg-muted/40 px-3 font-normal text-muted-foreground"
        onClick={() => setOpen(true)}
      >
        <Search data-icon="inline-start" />
        <span className="truncate">Search cases, registrations, pages…</span>
        <Kbd className="ml-auto hidden sm:inline-flex">⌘K</Kbd>
      </Button>
      <CommandDialog open={open} onOpenChange={setOpen} title="Command menu" description="Search cases or jump to a page">
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
          {NAV.map((group, i) => (
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
      </CommandDialog>
    </>
  );
}
