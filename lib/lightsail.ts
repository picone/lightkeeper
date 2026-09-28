import "server-only";
import {
  GetInstanceCommand,
  GetInstanceMetricDataCommand,
  GetOperationsCommand,
  GetStaticIpsCommand,
  LightsailClient,
  RebootInstanceCommand,
  type InstanceMetricName,
  type MetricStatistic,
  type MetricUnit,
} from "@aws-sdk/client-lightsail";
import { awsConfig } from "./env";
import type { Range } from "./http";

let client: LightsailClient | undefined;

export function lightsail(): LightsailClient {
  client ??= new LightsailClient({ region: awsConfig().region });
  return client;
}

export type StaticIpInfo = { name: string; ipAddress: string | null; isAttached: boolean; attachedTo: string | null };

export async function listStaticIps(): Promise<StaticIpInfo[]> {
  const out: StaticIpInfo[] = [];
  let pageToken: string | undefined;
  do {
    const page = await lightsail().send(new GetStaticIpsCommand({ pageToken }));
    for (const ip of page.staticIps ?? []) {
      out.push({
        name: ip.name ?? "",
        ipAddress: ip.ipAddress ?? null,
        isAttached: ip.isAttached ?? false,
        attachedTo: ip.attachedTo ?? null,
      });
    }
    pageToken = page.nextPageToken;
  } while (pageToken);
  return out;
}

export async function getInstanceOverview() {
  const { instanceName, region } = awsConfig();
  const [{ instance }, staticIps] = await Promise.all([
    lightsail().send(new GetInstanceCommand({ instanceName })),
    listStaticIps(),
  ]);
  return {
    region,
    instance: {
      name: instance?.name ?? instanceName,
      state: instance?.state?.name ?? "unknown",
      publicIp: instance?.publicIpAddress ?? null,
      ipv6: instance?.ipv6Addresses ?? [],
      isStaticIp: instance?.isStaticIp ?? false,
      blueprint: instance?.blueprintName ?? null,
      bundleId: instance?.bundleId ?? null,
      cpuCount: instance?.hardware?.cpuCount ?? null,
      ramGb: instance?.hardware?.ramSizeInGb ?? null,
      zone: instance?.location?.availabilityZone ?? null,
      createdAt: instance?.createdAt?.toISOString() ?? null,
    },
    staticIps,
    attachedStaticIp: staticIps.find((ip) => ip.isAttached && ip.attachedTo === instanceName) ?? null,
    // Unattached static IPs are billed; surface them loudly.
    unattachedStaticIps: staticIps.filter((ip) => !ip.isAttached),
  };
}

// Lightsail returns at most 1440 points per call; these keep every range under 300.
const PERIOD: Record<Range, number> = { 1: 300, 3: 900, 7: 3600 };

const METRICS: { key: string; name: InstanceMetricName; stat: MetricStatistic; unit: MetricUnit }[] = [
  { key: "cpu", name: "CPUUtilization", stat: "Average", unit: "Percent" },
  { key: "networkIn", name: "NetworkIn", stat: "Sum", unit: "Bytes" },
  { key: "networkOut", name: "NetworkOut", stat: "Sum", unit: "Bytes" },
  { key: "statusCheckFailed", name: "StatusCheckFailed", stat: "Sum", unit: "Count" },
];

export type Point = { t: number; v: number };

export async function getInstanceMetrics(days: Range) {
  const { instanceName } = awsConfig();
  const period = PERIOD[days];
  const endTime = new Date();
  const startTime = new Date(endTime.getTime() - days * 86400_000);

  const series = await Promise.all(
    METRICS.map(async (m) => {
      const out = await lightsail().send(
        new GetInstanceMetricDataCommand({
          instanceName,
          metricName: m.name,
          period,
          startTime,
          endTime,
          unit: m.unit,
          statistics: [m.stat],
        }),
      );
      const points: Point[] = (out.metricData ?? [])
        .filter((d) => d.timestamp)
        .map((d) => ({ t: d.timestamp!.getTime(), v: (m.stat === "Average" ? d.average : d.sum) ?? 0 }))
        .sort((a, b) => a.t - b.t);
      return [m.key, points] as const;
    }),
  );
  return { period, series: Object.fromEntries(series) as Record<string, Point[]> };
}

export async function getRecentOperations(limit = 10) {
  const { instanceName } = awsConfig();
  const ops = [];
  let pageToken: string | undefined;
  // Account-wide feed so released/renamed static IPs still show up; two pages is plenty for a single box.
  for (let i = 0; i < 2; i++) {
    const page = await lightsail().send(new GetOperationsCommand({ pageToken }));
    ops.push(...(page.operations ?? []));
    pageToken = page.nextPageToken;
    if (!pageToken) break;
  }
  return ops
    .filter((op) => op.resourceType === "StaticIp" || op.resourceName === instanceName)
    .map((op) => ({
      id: op.id ?? "",
      createdAt: op.createdAt?.toISOString() ?? null,
      type: op.operationType ?? "",
      resourceType: op.resourceType ?? "",
      resourceName: op.resourceName ?? "",
      status: op.status ?? "",
      details: op.operationDetails ?? "",
      errorCode: op.errorCode ?? null,
      errorDetails: op.errorDetails ?? null,
    }))
    .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""))
    .slice(0, limit);
}

export async function rebootInstance() {
  const { instanceName } = awsConfig();
  const out = await lightsail().send(new RebootInstanceCommand({ instanceName }));
  const op = out.operations?.[0];
  return { status: op?.status ?? "Started", operationId: op?.id ?? null };
}
