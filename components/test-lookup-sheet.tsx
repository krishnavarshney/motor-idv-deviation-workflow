"use client";

import { FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { SimulateClient } from "@/components/simulate-client";
import type { DecisionConfig } from "@/src/domain/motor-idv";

export function TestLookupSheet({
  decisionConfig,
  recentCases,
}: {
  decisionConfig: DecisionConfig;
  recentCases: Parameters<typeof SimulateClient>[0]["recentCases"];
}) {
  return (
    <Sheet>
      <SheetTrigger asChild>
        <Button variant="outline">
          <FlaskConical data-icon="inline-start" />
          Test lookup
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full overflow-y-auto sm:max-w-4xl">
        <SheetHeader>
          <SheetTitle>Test lookup</SheetTitle>
          <SheetDescription>Run an OBV valuation and the live decision rules without creating a case.</SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          <SimulateClient decisionConfig={decisionConfig} recentCases={recentCases} />
        </div>
      </SheetContent>
    </Sheet>
  );
}
