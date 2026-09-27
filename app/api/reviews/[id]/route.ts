import {NextResponse} from "next/server";
import {createClient} from "@/lib/supabase/server";
export async function POST(request:Request,{params}:{params:Promise<{id:string}>}){
 const {id}=await params; const supabase=await createClient(); const {data:{user}}=await supabase.auth.getUser();
 if(!user)return NextResponse.json({error:"Unauthorized"},{status:401});
 const body=await request.json(); const decision=body.decision;
 if(!["auto_approved","rejected"].includes(decision))return NextResponse.json({error:"Invalid decision"},{status:400});
 const notes=String(body.notes??"").trim(); if(notes.length<3)return NextResponse.json({error:"Reviewer notes are required"},{status:400});
 const {data:review}=await supabase.from("manual_reviews").select("id,case_id").eq("id",id).maybeSingle();
 if(!review)return NextResponse.json({error:"Review not found"},{status:404});
 const now=new Date().toISOString();
 const {error}=await supabase.from("manual_reviews").update({review_status:"completed",reviewer_decision:decision,reviewer_notes:notes,reviewed_at:now,assigned_to:user.id}).eq("id",id);
 if(error)return NextResponse.json({error:error.message},{status:400});
 await supabase.from("referral_cases").update({referral_status:decision==="auto_approved"?"approved":"rejected",workflow_status:"completed",processed_at:now}).eq("id",review.case_id);
 await supabase.from("audit_events").insert({case_id:review.case_id,event_type:"manual_review_completed",actor_type:"user",actor_id:user.id,severity:"info",payload:{decision,notes}});
 return NextResponse.json({ok:true});
}