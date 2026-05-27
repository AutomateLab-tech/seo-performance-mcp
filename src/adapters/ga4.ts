// GA4 Data API adapter. Returns engaged sessions / users / engagement time per page path.
// Auth: service account JSON with GA4 Data API access.

import { google } from "googleapis";
import { decodeJsonEnv, requireEnv } from "../config.js";
import type { VisitMetrics } from "../types.js";

let auth: InstanceType<typeof google.auth.JWT> | null = null;

function authClient(): InstanceType<typeof google.auth.JWT> {
  if (auth) return auth;
  const creds = decodeJsonEnv<{ client_email: string; private_key: string }>(
    "GA4_SERVICE_ACCOUNT_JSON",
  );
  auth = new google.auth.JWT({
    email: creds.client_email,
    key: creds.private_key,
    scopes: ["https://www.googleapis.com/auth/analytics.readonly"],
  });
  return auth;
}

function daysAgo(n: number): string {
  return `${n}daysAgo`;
}

interface RunReportRow {
  dimensionValues?: Array<{ value?: string }>;
  metricValues?: Array<{ value?: string }>;
}

export async function fetchGa4Metrics(
  pagePath: string,
  windowDays: 30 | 60 | 90,
): Promise<VisitMetrics> {
  const propertyId = requireEnv("GA4_PROPERTY_ID");
  const a = authClient();
  await a.authorize();

  const body = {
    dateRanges: [{ startDate: daysAgo(windowDays), endDate: "yesterday" }],
    dimensions: [{ name: "pagePath" }],
    metrics: [
      { name: "screenPageViews" },
      { name: "totalUsers" },
      { name: "userEngagementDuration" },
      { name: "bounceRate" },
      { name: "engagedSessions" },
    ],
    dimensionFilter: {
      filter: {
        fieldName: "pagePath",
        stringFilter: { matchType: "EXACT", value: pagePath },
      },
    },
    limit: "1",
  };

  const res = await a.request<{ rows?: RunReportRow[] }>({
    url: `https://analyticsdata.googleapis.com/v1beta/properties/${propertyId}:runReport`,
    method: "POST",
    data: body,
  });
  const row = res.data.rows?.[0];
  if (!row) {
    return {
      visits: 0,
      unique_visitors: 0,
      avg_time_on_page_s: 0,
      bounce_rate: 0,
    };
  }
  const vals = (row.metricValues ?? []).map((m) => parseFloat(m.value ?? "0"));
  const [views = 0, users = 0, engagement = 0, bounce = 0, engagedSessions = 0] = vals;
  const avgSeconds = engagedSessions > 0 ? engagement / engagedSessions : 0;
  return {
    visits: views,
    unique_visitors: users,
    avg_time_on_page_s: avgSeconds,
    bounce_rate: bounce,
  };
}
