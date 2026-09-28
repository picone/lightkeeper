import "server-only";
import { isIPv4 } from "node:net";
import {
  AllocateStaticIpCommand,
  AttachStaticIpCommand,
  DetachStaticIpCommand,
  GetStaticIpCommand,
  ReleaseStaticIpCommand,
} from "@aws-sdk/client-lightsail";
import { updateARecord } from "./cloudflare";
import { awsConfig, cloudflareConfig } from "./env";
import { lightsail, listStaticIps } from "./lightsail";

export type Step = { label: string; status: "ok" | "failed" | "skipped"; detail?: string };

export type RotateResult = {
  ok: boolean;
  steps: Step[];
  oldIp: string | null;
  newIp: string | null;
  newStaticIpName: string | null;
  /** Set whenever something needs the operator's attention. */
  alert: string | null;
};

class Abort extends Error {}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function waitFor(check: () => Promise<boolean>, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 1500));
  }
  throw new Error(`等待超时（${timeoutMs / 1000}s）`);
}

async function getStaticIp(name: string) {
  const { staticIp } = await lightsail().send(new GetStaticIpCommand({ staticIpName: name }));
  return staticIp;
}

function newStaticIpName(): string {
  // StaticIp-20260928103045
  return `StaticIp-${new Date().toISOString().slice(0, 19).replace(/[-:T]/g, "")}`;
}

/**
 * Detach + release the current static IP, allocate a new one, attach it, then repoint DNS.
 * Stops at the first Lightsail failure and says exactly what state was left behind,
 * because an allocated-but-unattached static IP is billed.
 */
export async function rotateStaticIp(): Promise<RotateResult> {
  const steps: Step[] = [];
  const result: RotateResult = { ok: false, steps, oldIp: null, newIp: null, newStaticIpName: null, alert: null };

  async function step<T>(label: string, fn: () => Promise<T>, onFail: string, describe?: (v: T) => string) {
    try {
      const value = await fn();
      steps.push({ label, status: "ok", detail: describe?.(value) });
      return value;
    } catch (err) {
      steps.push({ label, status: "failed", detail: errorMessage(err) });
      throw new Abort(onFail);
    }
  }

  try {
    // Validate all config before touching anything.
    const { instanceName } = await step("检查配置", async () => ({ ...awsConfig(), ...cloudflareConfig() }), "配置错误，未做任何改动。");
    const client = lightsail();

    const ips = await step("读取当前 static IP", listStaticIps, "无法读取 static IP，未做任何改动。", (list) => `共 ${list.length} 个`);
    const old = ips.find((ip) => ip.isAttached && ip.attachedTo === instanceName) ?? null;
    result.oldIp = old?.ipAddress ?? null;

    if (old) {
      await step(
        `解绑旧 IP ${old.name}（${old.ipAddress}）`,
        async () => {
          await client.send(new DetachStaticIpCommand({ staticIpName: old.name }));
          await waitFor(async () => (await getStaticIp(old.name))?.isAttached === false);
        },
        `解绑旧 IP ${old.name} 失败，未做其他改动。请到 Lightsail 控制台确认它是否仍绑定在 ${instanceName} 上。`,
      );
      await step(
        `删除旧 IP ${old.name}`,
        () => client.send(new ReleaseStaticIpCommand({ staticIpName: old.name })),
        `⚠️ 旧 IP ${old.name}（${old.ipAddress}）已解绑但删除失败，未绑定的 static IP 正在计费！请到 Lightsail 控制台手动删除，或重新绑定到 ${instanceName}。`,
      );
    } else {
      steps.push({ label: "解绑并删除旧 IP", status: "skipped", detail: `${instanceName} 当前没有绑定 static IP` });
    }

    const name = newStaticIpName();
    await step(
      `创建新 IP ${name}`,
      () => client.send(new AllocateStaticIpCommand({ staticIpName: name })),
      `旧 IP 已删除，但新 IP 创建失败。${instanceName} 目前使用临时公网 IP，DNS 未更新。请重试，或到 Lightsail 控制台处理。`,
    );
    result.newStaticIpName = name;

    const unattachedAlert = `⚠️ 新 IP ${name} 已创建但没有绑定成功，未绑定的 static IP 正在计费！请到 Lightsail 控制台把它绑定到 ${instanceName}，或删除它。`;
    await step(
      `绑定 ${name} 到 ${instanceName}`,
      async () => {
        await client.send(new AttachStaticIpCommand({ staticIpName: name, instanceName }));
        await waitFor(async () => (await getStaticIp(name))?.isAttached === true);
      },
      unattachedAlert,
    );

    const address = await step(
      "确认绑定并读取新 IP",
      async () => {
        const ip = await getStaticIp(name);
        if (!ip?.isAttached || ip.attachedTo !== instanceName) throw new Error(`${name} 未绑定到 ${instanceName}`);
        if (!ip.ipAddress || !isIPv4(ip.ipAddress)) throw new Error(`${name} 没有有效的 IPv4 地址`);
        return ip.ipAddress;
      },
      unattachedAlert,
      (ip) => ip,
    );
    result.newIp = address;

    // DNS: try every record even if one fails; the IP side is already settled.
    const failedRecords: string[] = [];
    for (const record of cloudflareConfig().recordNames) {
      try {
        const n = await updateARecord(record, address);
        steps.push({ label: `更新 DNS ${record} → ${address}`, status: "ok", detail: `${n} 条 A 记录` });
      } catch (err) {
        failedRecords.push(record);
        steps.push({ label: `更新 DNS ${record} → ${address}`, status: "failed", detail: errorMessage(err) });
      }
    }
    if (failedRecords.length) {
      result.alert = `IP 已换成 ${address}，但 DNS ${failedRecords.join("、")} 更新失败，请到 Cloudflare 手动修改 A 记录。`;
      return result;
    }

    result.ok = true;
    return result;
  } catch (err) {
    result.alert = err instanceof Abort ? err.message : `未预期的错误：${errorMessage(err)}`;
    return result;
  }
}
