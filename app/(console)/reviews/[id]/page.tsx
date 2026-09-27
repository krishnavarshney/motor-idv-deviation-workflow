import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { requirePageAction } from "@/lib/api-auth";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { DecisionBadge } from "@/components/status";
import { PageHeader } from "@/components/console";
import { DecisionEvidence, VehicleCard } from "@/components/decision-evidence";
import ReviewActions from "@/components/review-actions";
import { SectionLoaded, SectionProgress } from "@/components/section-progress";
import { EvidenceSkeleton, VehicleSkeleton } from "@/components/skeletons";

export const metadata = { title: "Review case" };

export default async function ReviewDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { supabase } = await requirePageAction("review");
  const { data: review } = await supabase.from("manual_reviews").select("*, referral_cases(*)").eq("id", id).maybeSingle();
  if (!review) notFound();
  const caseId = review.case_id;
  const c = review.referral_cases;

  return (
    <SectionProgress total={2}>
      <div className="flex flex-col gap-2">
        <Button variant="ghost" size="sm" asChild className="w-fit">
          <Link href="/reviews">
            <ChevronLeft data-icon="inline-start" />
            Manual review queue
          </Link>
        </Button>
        <PageHeader
          eyebrow="Manual review"
          title={
            <Link href={"/referrals/" + caseId} className="font-mono hover:underline">
              {c?.external_case_id}
            </Link>
          }
          description={review.review_reason}
          actions={<DecisionBadge status={review.review_status} className="h-7 px-3 text-sm" />}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Suspense fallback={<EvidenceSkeleton />}>
            <Evidence caseId={caseId} requestedIdv={c?.requested_idv} fallbackExplanation={review.review_reason} />
          </Suspense>
          <Suspense fallback={<VehicleSkeleton />}>
            <Vehicle caseId={caseId} fallback={c} />
          </Suspense>
        </div>
        <aside className="xl:sticky xl:top-20 xl:self-start">
          <ReviewActions reviewId={review.id} caseId={review.case_id} completed={review.review_status === "completed"} />
        </aside>
      </div>
    </SectionProgress>
  );
}

async function Evidence({ caseId, requestedIdv, fallbackExplanation }: { caseId: string; requestedIdv: unknown; fallbackExplanation?: string }) {
  const supabase = await createClient();
  const [{ data: idv }, { data: decision }] = await Promise.all([
    supabase.from("idv_checks").select("*").eq("case_id", caseId).maybeSingle(),
    supabase.from("approval_decisions").select("*").eq("case_id", caseId).maybeSingle(),
  ]);
  return (
    <>
      <SectionLoaded />
      <DecisionEvidence decision={decision} idv={idv} requestedIdv={requestedIdv} fallbackExplanation={fallbackExplanation} />
    </>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function Vehicle({ caseId, fallback }: { caseId: string; fallback: any }) {
  const supabase = await createClient();
  const { data: resolution } = await supabase.from("vehicle_resolutions").select("*").eq("case_id", caseId).maybeSingle();
  return (
    <>
      <SectionLoaded />
      <VehicleCard resolution={resolution} fallback={fallback} />
    </>
  );
}
