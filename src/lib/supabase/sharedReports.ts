"use client";

import { getAuthenticatedSupabase, getBrowserSupabase } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { logSupabaseError } from "@/lib/supabase/errors";
import type { DoctorReport, ReportSpecialty, SharedReport } from "@/lib/schema";

function createShareToken() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return `shr_${crypto.randomUUID().replace(/-/g, "")}`;
  }
  return `shr_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

export async function createSharedReport(input: {
  patientName: string;
  specialty: ReportSpecialty;
  report: DoctorReport;
}): Promise<SharedReport> {
  if (!isSupabaseConfigured()) {
    throw new Error("Supabase is not configured");
  }

  const auth = await getAuthenticatedSupabase();
  if (!auth) {
    throw new Error("Sign in to create a shareable link");
  }

  const token = createShareToken();
  const createdAt = new Date().toISOString();

  const { error } = await auth.supabase.from("shared_reports").insert({
    token,
    user_id: auth.userId,
    patient_name: input.patientName,
    specialty: input.specialty,
    report: input.report,
    created_at: createdAt,
  });

  if (error) {
    logSupabaseError("createSharedReport", error);
    throw new Error("Could not create a shareable link. Try again later.");
  }

  return {
    token,
    patientName: input.patientName,
    specialty: input.specialty,
    report: input.report,
    createdAt,
  };
}

export async function getSharedReport(token: string): Promise<SharedReport | null> {
  if (!isSupabaseConfigured()) return null;

  const supabase = getBrowserSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("shared_reports")
    .select("token, patient_name, specialty, report, created_at")
    .eq("token", token)
    .maybeSingle();

  if (error) {
    logSupabaseError("getSharedReport", error);
    return null;
  }
  if (!data) return null;

  return {
    token: data.token,
    patientName: data.patient_name,
    specialty: data.specialty as ReportSpecialty,
    report: data.report as DoctorReport,
    createdAt: data.created_at,
  };
}
