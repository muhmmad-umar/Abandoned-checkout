"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { apiCall, type ApiResult } from "@/lib/api";
import type { BriefItemStatus, RoadmapPreview } from "@/lib/types";

const page = (id: string) => `/campaigns/${id}`;

export async function previewOpinion(campaignId: string, clientPct: number) {
  return apiCall<{ systemPct: number; clientPct: number; opinion: string | null }>(`/campaigns/${campaignId}/recommendation/opinion`, { method: "POST", body: { clientPct } });
}

export async function applyScale(
  campaignId: string,
  body: { recommendationId: string; clientPct: number; earlyOverride?: boolean; ceilingOverride?: boolean },
) {
  const r = await apiCall<{ ok: true; cycleNumber: number; budgetBefore: number; budgetAfter: number; cooldownEndsAt: string }>(`/campaigns/${campaignId}/scale`, { method: "POST", body });
  revalidatePath(page(campaignId), "layout");
  return r;
}

export async function updateBriefItem(campaignId: string, itemId: string, status: BriefItemStatus) {
  const r = await apiCall(`/brief-items/${itemId}`, { method: "PATCH", body: { status } });
  revalidatePath(page(campaignId), "layout");
  return r;
}

export async function tagCreative(campaignId: string, adId: string, fields: { format?: string; angle?: string | null; visualStyle?: string | null; tone?: string | null }) {
  const r = await apiCall(`/ads/${adId}`, { method: "PATCH", body: fields });
  revalidatePath(page(campaignId), "layout");
  return r;
}

export async function requestCreativeAnalysis(campaignId: string) {
  return apiCall(`/campaigns/${campaignId}/creative-analysis`, { method: "POST", body: {} });
}

export async function previewRoadmap(campaignId: string, payload: unknown): Promise<ApiResult<RoadmapPreview>> {
  return apiCall<RoadmapPreview>(`/campaigns/${campaignId}/roadmap/preview`, { method: "POST", body: payload });
}

export async function submitBrief(campaignId: string, payload: unknown) {
  const r = await apiCall(`/campaigns/${campaignId}/brief`, { method: "POST", body: payload });
  if (!r.ok) return r;
  revalidatePath("/campaigns");
  redirect(`${page(campaignId)}?submitted=1`);
}

export async function chooseGoal(campaignId: string, body: { choice: "new_target"; targetDailyConversions: number; maxBudgetCap?: number } | { choice: "maintain" } | { choice: "pause" }) {
  const r = await apiCall<{ status: string; message?: string }>(`/campaigns/${campaignId}/goal`, { method: "POST", body });
  revalidatePath(page(campaignId), "layout");
  return r;
}

export async function answerInsight(campaignId: string, kind: string, accept: boolean) {
  const r = await apiCall(`/campaigns/${campaignId}/profile/insights/${kind}`, { method: "POST", body: { accept } });
  revalidatePath(page(campaignId), "layout");
  return r;
}

export async function importCampaign(adAccountId: string, platformCampaignId: string, name: string) {
  const r = await apiCall<{ id: string }>("/campaigns", { method: "POST", body: { adAccountId, platformCampaignId, name } });
  if (!r.ok) return r;
  redirect(`${page(r.data.id)}/setup`);
}

export async function connectMeta() {
  const r = await apiCall<{ url: string }>("/meta/connect");
  if (!r.ok) return r;
  redirect(r.data.url);
}

export async function saveNotificationPrefs(prefs: { email: boolean; inApp: boolean; slack: boolean; slackWebhookUrl: string | null }) {
  const r = await apiCall("/me/notifications", { method: "PATCH", body: prefs });
  revalidatePath("/settings");
  return r;
}

export async function saveAngleTaxonomy(angles: string[]) {
  const r = await apiCall<{ angleTaxonomy: string[] }>("/me/angle-taxonomy", { method: "PUT", body: { angles } });
  revalidatePath("/settings");
  return r;
}

export async function markNotificationRead(id: string) {
  await apiCall(`/notifications/${id}/read`, { method: "POST", body: {} });
  revalidatePath("/", "layout");
}
