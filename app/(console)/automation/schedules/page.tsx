import { CalendarClock, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, PageHeader } from "@/components/console";
import { DecisionBadge } from "@/components/status";
import { ScheduleDialog } from "@/components/schedule-dialog";
import { ScheduleEnabledSwitch, ScheduleRowActions } from "@/components/schedule-row-actions";
import { getSessionProfile } from "@/lib/api-auth";
import { can } from "@/lib/authz";
import { describeSchedule } from "@/lib/schedule";
import { dateTime } from "@/lib/format";

export const metadata = { title: "Schedules" };

export default async function Schedules() {
  const supabase = await createClient();
  const [profile, { data: schedules }, { data: jobs }] = await Promise.all([
    getSessionProfile(supabase),
    supabase.from("automation_schedules").select("*").order("created_at"),
    supabase
      .from("automation_jobs")
      .select("schedule_id,status,finished_at")
      .not("schedule_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  const isAdmin = can(profile?.role, "manage");
  const lastJob = new Map<string, { status: string; finished_at: string | null }>();
  for (const j of jobs ?? []) if (!lastJob.has(j.schedule_id)) lastJob.set(j.schedule_id, j);
  const rows = schedules ?? [];

  return (
    <>
      <PageHeader
        eyebrow="Automation"
        title="Schedules"
        description="Scheduled runs fetch new CoreHub referrals and evaluate them. A slot is skipped if the previous run is still going."
        actions={
          isAdmin ? (
            <ScheduleDialog
              trigger={
                <Button>
                  <Plus data-icon="inline-start" />
                  New schedule
                </Button>
              }
            />
          ) : undefined
        }
      />

      <Card className="pb-0">
        <CardHeader>
          <CardTitle>{rows.length} schedules</CardTitle>
          <CardDescription>{isAdmin ? "New schedules start paused." : "Only admins can change schedules."}</CardDescription>
        </CardHeader>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-4">Enabled</TableHead>
              <TableHead>Name</TableHead>
              <TableHead>Cadence</TableHead>
              <TableHead className="hidden md:table-cell">Next run</TableHead>
              <TableHead className="hidden lg:table-cell">Last result</TableHead>
              {isAdmin && <TableHead className="pr-4 text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((s) => {
              const last = lastJob.get(s.id);
              return (
                <TableRow key={s.id}>
                  <TableCell className="pl-4">
                    {isAdmin ? <ScheduleEnabledSwitch id={s.id} enabled={s.enabled} name={s.name} /> : s.enabled ? "On" : "Paused"}
                  </TableCell>
                  <TableCell>
                    <div className="font-medium">{s.name}</div>
                    {s.dry_run && <div className="text-xs text-muted-foreground">Dry run</div>}
                  </TableCell>
                  <TableCell>{describeSchedule(s.cron, s.timezone)}</TableCell>
                  <TableCell className="hidden md:table-cell">{s.enabled ? dateTime(s.next_run_at) : "—"}</TableCell>
                  <TableCell className="hidden lg:table-cell">
                    {last ? (
                      <div className="flex items-center gap-2">
                        <DecisionBadge status={last.status} />
                        <span className="text-xs text-muted-foreground">{dateTime(last.finished_at)}</span>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">Never run</span>
                    )}
                  </TableCell>
                  {isAdmin && (
                    <TableCell className="pr-4">
                      <ScheduleRowActions schedule={{ id: s.id, name: s.name, cron: s.cron, timezone: s.timezone, dry_run: s.dry_run }} />
                    </TableCell>
                  )}
                </TableRow>
              );
            })}
            {!rows.length && (
              <EmptyRow colSpan={isAdmin ? 6 : 5} icon={CalendarClock} title="No schedules" description="Create one to fetch and evaluate referrals automatically." />
            )}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}
