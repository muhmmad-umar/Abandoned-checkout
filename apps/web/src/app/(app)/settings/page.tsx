import { AngleTaxonomyForm, NotificationPrefsForm } from "@/components/settings/settings-forms";
import { apiGet } from "@/lib/api";

export const metadata = { title: "Settings" };

interface Me { email: string; notificationPreferences: { email?: boolean; inApp?: boolean; slack?: boolean; slackWebhookUrl?: string | null }; angleTaxonomy: string[] }

export default async function SettingsPage() {
  const me = await apiGet<Me>("/me");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-ink-secondary">{me.email}</p>
      </div>
      <NotificationPrefsForm initial={me.notificationPreferences} />
      <AngleTaxonomyForm initial={me.angleTaxonomy} />
    </div>
  );
}
